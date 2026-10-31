import Link from "next/link";
import { notFound } from "next/navigation";
import { adminSql, withDealer } from "@/lib/db";
import { formatKpi, kpiValue, type KpiMap } from "@/lib/kpis/value";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const COLUMNS = ["activations", "upgrades", "accessory_revenue", "autopay_rate", "protect_rate", "wtr"] as const;
const LABELS: Record<string, string> = {
  activations: "Activations", upgrades: "Upgrades", accessory_revenue: "Accessories",
  autopay_rate: "Autopay", protect_rate: "Protect", wtr: "WTR",
};

interface Unit { id: number; name: string; level_key: string; code: string | null; path: string }
interface Row extends Unit { store_count: number | null; m: KpiMap | null; goal: string | null }

type Search = { unit?: string; q?: string; page?: string };

// Step 1 preview: walk the org tree with pre-added totals, paged and searchable.
export default async function DealerBrowser({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const [dealer] = await adminSql<{ id: number; name: string; primary_color: string }[]>`
    select id, name, primary_color from dealers where slug = ${slug}`;
  if (!dealer) notFound();

  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().toLowerCase();

  const data = await withDealer(dealer.id, async (sql) => {
    const labels = Object.fromEntries(
      (await sql<{ level_key: string; label: string }[]>`select level_key, label from dealer_org_levels`).map((l) => [l.level_key, l.label]),
    );
    const [current] = sp.unit
      ? await sql<Unit[]>`select id, name, level_key, code, path::text from org_units where id = ${Number(sp.unit)}`
      : await sql<Unit[]>`select id, name, level_key, code, path::text from org_units where level_key = 'dealer'`;
    if (!current) return null;

    const [{ d: latest }] = await sql<{ d: Date }[]>`select max(biz_date) as d from org_rollup_daily`;
    const month = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1));

    const crumbs = await sql<Unit[]>`
      select id, name, level_key, code, path::text from org_units
       where path @> ${current.path}::ltree order by nlevel(path)`;

    const [{ m: currentM }] = await sql<{ m: KpiMap | null }[]>`
      select (select m from org_rollup_daily where org_unit_id = ${current.id} and biz_date = ${latest}) as m`;

    // Children (or, when searching, any matching unit below this one), one page at a time.
    const where = q
      ? sql`path <@ ${current.path}::ltree and id <> ${current.id} and lower(name || ' ' || coalesce(code, '')) like ${"%" + q + "%"}`
      : sql`parent_id = ${current.id}`;
    const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from org_units where ${where}`;
    const rows = await sql<Row[]>`
      with page as (
        select id, name, level_key, code, path from org_units where ${where}
         order by level_key = 'store', name limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
      )
      select p.id, p.name, p.level_key, p.code, p.path::text, r.store_count, r.m,
             (select sum(g.target) from kpi_goals g join org_units st on st.id = g.org_unit_id
               where g.kpi_code = 'activations' and g.goal_set = 'dealer' and g.month = ${month} and st.path <@ p.path) as goal
        from page p
        left join org_rollup_daily r on r.org_unit_id = p.id and r.biz_date = ${latest}
       order by p.level_key = 'store', p.name`;

    // At a store: list reps, leaving out anyone hidden from rep views.
    let reps: { display_name: string; m: KpiMap }[] = [];
    let hiddenCount = 0;
    if (current.level_key === "store") {
      reps = await sql`
        select p.display_name, r.m from rep_daily_mtd r join people p on p.id = r.person_id
         where r.store_id = ${current.id} and r.biz_date = ${latest} and not p.hidden_from_rep_views
         order by (r.m ->> 'activations')::int desc, p.display_name`;
      [{ n: hiddenCount }] = await sql<{ n: number }[]>`
        select count(*)::int as n from rep_daily_mtd r join people p on p.id = r.person_id
         where r.store_id = ${current.id} and r.biz_date = ${latest} and p.hidden_from_rep_views`;
    }
    // Stores held by the latest import (their files didn't match), anywhere under this unit.
    const held = await sql<{ store_id: number; batch_id: number; path: string }[]>`
      select h.store_id, h.batch_id, u.path::text from import_held_stores h
        join import_batches b on b.id = h.batch_id and b.status = 'done'
        join org_units u on u.id = h.store_id
       where h.biz_date = ${latest} and h.status = 'held' and u.path <@ ${current.path}::ltree`;
    return { labels, current, latest, crumbs, currentM, total, rows, reps, hiddenCount, held };
  });
  if (!data) notFound();

  const { labels, current, latest, crumbs, currentM, total, rows, reps, hiddenCount, held } = data;
  // Held stores under a row (rows can be territories, districts... or single stores).
  const heldUnder = (path: string) => held.filter((h) => h.path === path || h.path.startsWith(path + ".")).length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (o: Search) => {
    const p = new URLSearchParams();
    const unit = o.unit ?? String(current.id);
    p.set("unit", unit);
    if (o.q) p.set("q", o.q);
    if (o.page && o.page !== "1") p.set("page", o.page);
    return `/d/${slug}?${p}`;
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-end">
        <span className="text-sm text-gray-500">
          Numbers through {latest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} (month to date)
        </span>
      </div>

      <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-400">›</span>}
            <Link href={href({ unit: String(c.id) })} className={c.id === current.id ? "font-semibold" : "text-gray-600 hover:underline"}>
              {c.name}
            </Link>
          </span>
        ))}
      </nav>

      <h1 className="mt-2 text-2xl font-semibold" style={{ color: dealer.primary_color }}>
        {current.name} <span className="text-base font-normal text-gray-500">{labels[current.level_key]}</span>
      </h1>

      {held.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {current.level_key === "store" ? "This store is" : `${held.length} store${held.length === 1 ? "" : "s"} in this view ${held.length === 1 ? "is" : "are"}`} on hold:
          the latest files didn&apos;t match, so {current.level_key === "store" ? "it shows its" : "they show their"} last good numbers.{" "}
          <Link href={`/d/${slug}/imports/${held[0].batch_id}`} className="font-medium underline">Review</Link>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {COLUMNS.map((k) => (
          <div key={k} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs text-gray-500">{LABELS[k]}</div>
            <div className="text-xl font-semibold">{formatKpi(k, kpiValue(currentM, k))}</div>
          </div>
        ))}
      </div>

      {current.level_key !== "store" && (
        <>
          <form className="mt-6 flex gap-2" action={`/d/${slug}`}>
            <input type="hidden" name="unit" value={current.id} />
            <input name="q" defaultValue={sp.q} placeholder="Search stores, districts… (name or store #)"
              className="w-80 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm" />
            <button className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Search</button>
            {q && <Link href={href({})} className="px-2 py-1.5 text-sm text-gray-600 hover:underline">Clear</Link>}
          </form>

          <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Level</th>
                  <th className="px-3 py-2 text-right">Stores</th>
                  {COLUMNS.map((k) => <th key={k} className="px-3 py-2 text-right">{LABELS[k]}</th>)}
                  <th className="px-3 py-2 text-right">Act. goal</th>
                  <th className="px-3 py-2 text-right">% to goal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const acts = kpiValue(r.m, "activations");
                  const goal = r.goal ? Number(r.goal) : undefined;
                  const pct = acts !== undefined && goal ? acts / goal : undefined;
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <Link href={href({ unit: String(r.id) })} className="font-medium hover:underline">
                          {r.level_key === "store" ? `${r.code} · ${r.name}` : r.name}
                        </Link>
                        {heldUnder(r.path) > 0 && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            {r.level_key === "store" ? "On hold" : `${heldUnder(r.path)} on hold`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{labels[r.level_key]}</td>
                      <td className="px-3 py-2 text-right">{r.store_count ?? "–"}</td>
                      {COLUMNS.map((k) => <td key={k} className="px-3 py-2 text-right">{formatKpi(k, kpiValue(r.m, k))}</td>)}
                      <td className="px-3 py-2 text-right">{formatKpi("activations", goal)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${pct === undefined ? "" : pct >= 0.97 ? "text-green-700" : pct >= 0.85 ? "text-amber-600" : "text-red-600"}`}>
                        {pct === undefined ? "–" : `${Math.round(pct * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={COLUMNS.length + 5} className="px-3 py-6 text-center text-gray-500">Nothing found.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
            <span>{total.toLocaleString()} {q ? "matches" : "items"} · page {page} of {pages}</span>
            <span className="flex gap-3">
              {page > 1 && <Link className="hover:underline" href={href({ q: sp.q, page: String(page - 1) })}>← Previous</Link>}
              {page < pages && <Link className="hover:underline" href={href({ q: sp.q, page: String(page + 1) })}>Next →</Link>}
            </span>
          </div>
        </>
      )}

      {current.level_key === "store" && (
        <div className="mt-6">
          <h2 className="font-semibold">Reps at this store</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Rep</th>
                  {COLUMNS.map((k) => <th key={k} className="px-3 py-2 text-right">{LABELS[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.display_name} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium">{r.display_name}</td>
                    {COLUMNS.map((k) => <td key={k} className="px-3 py-2 text-right">{formatKpi(k, kpiValue(r.m, k))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hiddenCount > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              Store totals above also include {hiddenCount} person hidden from rep views.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
