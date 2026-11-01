import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Crumbs, KpiTile, Legend, Pager, TrendBars, cellClass, dailyFromMtd } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";
import { goalsFor } from "@/lib/kpis/goals";
import { evaluate } from "@/lib/kpis/pace";
import { OVERVIEW_COLUMNS, shortLabel, TILE_KPIS } from "@/lib/kpis/sets";
import { valueExpr } from "@/lib/kpis/sql";
import { formatKpi, kpiValue, type KpiMap } from "@/lib/kpis/value";
import { repHref, unitHref, withParams } from "@/lib/links";
import { fmtDate, orgContext, plural, unitName } from "@/lib/org";
import { repsUnder } from "@/lib/reps";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
type Search = { unit?: string; q?: string; page?: string; sort?: string };

/**
 * Overview for any level above a store (company, region, area, district): headline
 * KPIs vs pace, daily trend, the units one level down, and the top reps.
 */
export default async function Overview({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireAccess(slug);
  const { dealer } = access;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort = sp.sort && KPI_BY_CODE[sp.sort] ? sp.sort : "";

  const data = await withDealer(dealer.id, async (sql) => {
    const ctx = await orgContext(sql, sp.unit, access.roots);
    if (!ctx) return null;
    const { current, latestIso, mp } = ctx;
    if (current.level_key === "store") return "store" as const;

    const [{ m: currentM }] = await sql<{ m: KpiMap | null }[]>`
      select (select m from org_rollup_daily where org_unit_id = ${current.id} and biz_date = ${latestIso}) as m`;

    const where = q
      ? sql`u.path <@ ${current.path}::ltree and u.id <> ${current.id} and lower(u.name || ' ' || coalesce(u.code, '')) like ${"%" + q + "%"}`
      : sql`u.parent_id = ${current.id}`;
    const order = sort ? sql.unsafe(`${valueExpr(sort, "r.m")} desc nulls last, u.name`) : sql`u.level_key = 'store', u.code, u.name`;
    const rows = await sql<{ id: number; name: string; level_key: string; code: string | null; path: string; parent_id: number | null; store_count: number | null; m: KpiMap | null; total: number }[]>`
      select u.id, u.name, u.level_key, u.code, u.path::text, u.parent_id, r.store_count, r.m, count(*) over ()::int as total
        from org_units u
        left join org_rollup_daily r on r.org_unit_id = u.id and r.biz_date = ${latestIso}
       where ${where}
       order by ${order}
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;

    const goals = await goalsFor(sql, [current.id, ...rows.map((r) => r.id)], mp.month);

    const trend = await sql<{ biz_date: Date; v: string | null }[]>`
      select biz_date, m ->> 'activations' as v from org_rollup_daily
       where org_unit_id = ${current.id} and biz_date between ${mp.month} and ${latestIso} order by biz_date`;

    const topReps = await repsUnder(sql, { path: current.path, date: latestIso, kpis: ["activations", "upgrades", "accessory_revenue"], sort: "activations", limit: 8, offset: 0 });

    const held = await sql<{ store_id: number; batch_id: number; path: string }[]>`
      select h.store_id, h.batch_id, u.path::text from import_held_stores h
        join import_batches b on b.id = h.batch_id and b.status = 'done'
        join org_units u on u.id = h.store_id
       where h.biz_date = ${latestIso} and h.status = 'held' and u.path <@ ${current.path}::ltree`;
    return { ctx, currentM, rows, goals, trend, topReps, held };
  });
  if (!data) notFound();
  if (data === "store") redirect(`/d/${slug}/store/${sp.unit}`);

  const { ctx, currentM, rows, goals, trend, topReps, held } = data;
  const { current, crumbs, labels, mp, levels } = ctx;
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const childLevel = levels[levels.indexOf(current.level_key) + 1] ?? "store";
  const myGoals = goals.get(current.id) ?? {};
  const heldUnder = (path: string) => held.filter((h) => h.path === path || h.path.startsWith(path + ".")).length;
  const onTarget = TILE_KPIS.map((k) => evaluate(k, kpiValue(currentM, k), myGoals[k], mp)).filter((e) => e.status === "on" || e.status === "ahead").length;
  const tracked = TILE_KPIS.filter((k) => myGoals[k] !== undefined).length;
  const here = (o: Search) => withParams(`/d/${slug}`, { unit: current.id, q: o.q, page: o.page, sort: o.sort });

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Crumbs crumbs={crumbs} labels={labels} href={(u) => unitHref(slug, u)} />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold" style={{ color: dealer.primary_color }}>
          {current.name} <span className="text-base font-normal text-gray-500">{labels[current.level_key]}</span>
        </h1>
        <span className="text-sm text-gray-500">
          Month to date through {fmtDate(ctx.latest, { weekday: "long", month: "long", day: "numeric" })} · {Math.round(mp.share * 100)}% of the month
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        On target for {onTarget} of {tracked} KPIs · {formatKpi("net_adds", kpiValue(currentM, "net_adds"))} net adds · {formatKpi("open_stores", kpiValue(currentM, "open_stores"))} stores
      </p>

      {held.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {held.length} store{held.length === 1 ? "" : "s"} in this view {held.length === 1 ? "is" : "are"} on hold: the latest files didn&apos;t match,
          so {held.length === 1 ? "it shows its" : "they show their"} last good numbers.{" "}
          <Link href={`/d/${slug}/imports/${held[0].batch_id}`} className="font-medium underline">Review</Link>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {TILE_KPIS.map((k) => <KpiTile key={k} code={k} e={evaluate(k, kpiValue(currentM, k), myGoals[k], mp)} />)}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendBars days={dailyFromMtd(trend)} code="activations" color={dealer.primary_color} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">Top reps · activations</div>
            <Link href={withParams(`/d/${slug}/rankings`, { unit: current.id, level: "rep" })} className="text-xs text-gray-500 hover:underline">All rankings →</Link>
          </div>
          <ol className="mt-2 space-y-1.5 text-sm">
            {topReps.map((r) => (
              <li key={r.person_id} className="flex items-center justify-between gap-2">
                <span className="truncate"><span className="mr-2 text-gray-400">{r.rank}.</span>
                  <Link href={repHref(slug, r.person_id)} className="hover:underline">{r.display_name}</Link>
                  <span className="ml-1 text-xs text-gray-400">{r.stores}</span></span>
                <span className="font-medium">{formatKpi("activations", kpiValue(r.m, "activations"))}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{q ? "Search results" : plural(labels[childLevel])}</h2>
        <form className="flex gap-2" action={`/d/${slug}`}>
          <input type="hidden" name="unit" value={current.id} />
          <input name="q" defaultValue={sp.q} placeholder="Find a store, district… (name or #)"
            className="w-72 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm" />
          <button className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Search</button>
          {q && <Link href={here({})} className="px-2 py-1.5 text-sm text-gray-600 hover:underline">Clear</Link>}
        </form>
      </div>
      <div className="mt-2"><Legend /></div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Stores</th>
              {OVERVIEW_COLUMNS.map((k) => (
                <th key={k} className="px-3 py-2 text-right">
                  <Link href={here({ q: sp.q, sort: sort === k ? undefined : k })} className="hover:underline">
                    {shortLabel(k)}{sort === k ? " ↓" : ""}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const g = goals.get(r.id) ?? {};
              const n = heldUnder(r.path);
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link href={unitHref(slug, r)} className="font-medium hover:underline">{unitName(r)}</Link>
                    {q && <span className="ml-1 text-xs text-gray-400">{labels[r.level_key]}</span>}
                    {n > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{r.level_key === "store" ? "On hold" : `${n} on hold`}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{r.store_count ?? "–"}</td>
                  {OVERVIEW_COLUMNS.map((k) => {
                    const e = evaluate(k, kpiValue(r.m, k), g[k], mp);
                    return (
                      <td key={k} className={`px-3 py-2 text-right ${cellClass(e.status)}`}
                        title={e.target !== undefined ? `Target ${formatKpi(k, e.target)} · ${Math.round((e.pct ?? 0) * 100)}%` : undefined}>
                        {formatKpi(k, e.actual)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={OVERVIEW_COLUMNS.length + 2} className="px-3 py-6 text-center text-gray-500">Nothing found.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} total={total} noun={q ? "matches" : "items"} href={(p) => here({ q: sp.q, sort, page: String(p) })} />
    </main>
  );
}
