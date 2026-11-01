import Link from "next/link";
import { notFound } from "next/navigation";
import ReportBuilder from "@/components/ReportBuilder";
import { Crumbs, Legend, Pager, cellClass } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { KPI_BY_CODE, KPI_CATALOG } from "@/lib/kpis/catalog";
import { goalsFor } from "@/lib/kpis/goals";
import { evaluate } from "@/lib/kpis/pace";
import { valueExpr } from "@/lib/kpis/sql";
import { formatKpi, isVolume, kpiValue, type KpiMap } from "@/lib/kpis/value";
import { repHref, unitHref, withParams } from "@/lib/links";
import { fmtDate, orgContext, plural, unitName } from "@/lib/org";
import { repsUnder } from "@/lib/reps";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const DEFAULT_KPIS = ["activations", "upgrades", "accessory_revenue", "autopay_rate", "protect_rate", "upgrade_plus_rate", "chi_orders", "wtr"];
type Search = { unit?: string; level?: string; kpis?: string; report?: string; sort?: string; dir?: string; page?: string };

/** Store KPI report: any KPIs, one row per store / district / rep, colored vs today's pace. */
export default async function KpiReport({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireAccess(slug);
  const { dealer } = access;
  const page = Math.max(1, Number(sp.page) || 1);

  const data = await withDealer(dealer.id, async (sql) => {
    const ctx = await orgContext(sql, sp.unit, access.roots);
    if (!ctx) return null;
    const { current, levels, latestIso, mp } = ctx;

    const reports = await sql<{ id: number; name: string; row_level: string; is_official: boolean; kpis: string[] }[]>`
      select r.id, r.name, r.row_level, r.is_official,
             array(select k.kpi_code from saved_report_kpis k where k.report_id = r.id order by k.position) as kpis
        from saved_reports r
       where r.is_official or r.owner_user_id = ${access.user.id}
       order by r.is_official desc, r.name`;
    const fromUrl = sp.kpis?.split(",").filter((k) => KPI_BY_CODE[k]) ?? [];
    const active = fromUrl.length ? null : reports.find((r) => String(r.id) === sp.report) ?? reports.find((r) => r.is_official) ?? null;
    const kpis = fromUrl.length ? fromUrl : active?.kpis.length ? active.kpis : DEFAULT_KPIS;

    const below = levels.slice(levels.indexOf(current.level_key) + 1);
    const levelOptions = [...below, "rep"];
    const wanted = sp.level ?? active?.row_level ?? "store";
    const level = levelOptions.includes(wanted) ? wanted : levelOptions[0];
    const sort = sp.sort && kpis.includes(sp.sort) ? sp.sort : null;
    const dir = sp.dir === "asc" ? "asc" : "desc";

    const [{ m: totalM }] = await sql<{ m: KpiMap | null }[]>`
      select (select m from org_rollup_daily where org_unit_id = ${current.id} and biz_date = ${latestIso}) as m`;

    let rows: { id: number; name: string; sub: string; href: string; m: KpiMap | null; goalsKey: number | null; total: number }[];
    if (level === "rep") {
      const reps = await repsUnder(sql, { path: current.path, date: latestIso, kpis, sort: sort ?? kpis[0], dir, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      rows = reps.map((r) => ({ id: r.person_id, name: r.display_name, sub: `Store ${r.stores}`, href: repHref(slug, r.person_id), m: r.m, goalsKey: null, total: r.total }));
    } else {
      const order = sort ? sql.unsafe(`${valueExpr(sort, "r.m")} ${dir} nulls last, u.code, u.name`) : sql`u.code, u.name`;
      const units = await sql<{ id: number; name: string; code: string | null; level_key: string; parent: string | null; m: KpiMap | null; total: number }[]>`
        select u.id, u.name, u.code, u.level_key, p.name as parent, r.m, count(*) over ()::int as total
          from org_units u
          left join org_rollup_daily r on r.org_unit_id = u.id and r.biz_date = ${latestIso}
          left join org_units p on p.id = u.parent_id
         where u.level_key = ${level} and u.path <@ ${current.path}::ltree
         order by ${order}
         limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
      rows = units.map((u) => ({ id: u.id, name: unitName(u), sub: u.parent ?? "", href: unitHref(slug, u), m: u.m, goalsKey: u.id, total: u.total }));
    }
    const goals = await goalsFor(sql, [current.id, ...rows.flatMap((r) => (r.goalsKey ? [r.goalsKey] : []))], mp.month);
    return { ctx, reports, active, kpis, level, levelOptions, sort, dir, totalM, rows, goals };
  });
  if (!data) notFound();
  const { ctx, reports, active, kpis, level, levelOptions, sort, dir, totalM, rows, goals } = data;
  const { current, crumbs, labels, mp } = ctx;
  const total = rows[0]?.total ?? 0;
  const myGoals = goals.get(current.id) ?? {};
  // Reps get the company's rate targets; volume goals live at stores, so rep volume cells aren't colored.
  const rowGoals = (r: (typeof rows)[number]) =>
    r.goalsKey ? goals.get(r.goalsKey) ?? {} : Object.fromEntries(Object.entries(myGoals).filter(([k]) => !isVolume(k)));
  const base = { unit: current.id, level, report: active?.id, kpis: active ? undefined : kpis.join(",") };
  const here = (o: Partial<Search>) => withParams(`/d/${slug}/report`, { ...base, sort: sort ?? undefined, dir: sort ? dir : undefined, ...o });
  const levelLabel = (l: string) => (l === "rep" ? "Rep" : labels[l]);
  const title = active?.name ?? "Custom report";

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <Crumbs crumbs={crumbs} labels={labels} href={(u) => withParams(`/d/${slug}/report`, { ...base, unit: u.id })} />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <span className="text-sm text-gray-500">
          Month to date through {fmtDate(ctx.latest, { weekday: "long", month: "long", day: "numeric" })} · {mp.day} of {mp.daysInMonth} days ({Math.round(mp.share * 100)}% of the month)
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm print:hidden">
        <span className="text-gray-500">Reports:</span>
        {reports.map((r) => (
          <Link key={r.id} href={withParams(`/d/${slug}/report`, { unit: current.id, report: r.id })}
            className={`rounded-full px-3 py-1 ${active?.id === r.id ? "bg-gray-800 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
            {r.name}{r.is_official ? " ★" : ""}
          </Link>
        ))}
      </div>

      <div className="mt-3">
        <ReportBuilder slug={slug} unitId={current.id} color={dealer.primary_color} reportName={title} reportId={active?.id ?? null}
          canDelete={!!active && (!active.is_official || access.isAdmin)} canShare={access.isAdmin} selected={kpis} level={level}
          levels={levelOptions.map((l) => ({ key: l, label: levelLabel(l) }))}
          kpis={KPI_CATALOG.filter((k) => k.code !== "open_stores").map((k) => ({ code: k.code, label: k.label, category: k.category, description: k.description }))} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Legend />
        <span className="text-xs text-gray-500">Click a column to sort. ★ = official company report.</span>
      </div>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2">{levelLabel(level)}</th>
              {kpis.map((k) => (
                <th key={k} className="min-w-[90px] px-3 py-2 text-right align-bottom">
                  <Link href={here({ sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc", page: undefined })} className="hover:underline">
                    {KPI_BY_CODE[k].label}{sort === k ? (dir === "desc" ? " ↓" : " ↑") : ""}
                  </Link>
                  {myGoals[k] !== undefined && !isVolume(k) && <span className="block font-normal normal-case text-gray-400">target {formatKpi(k, myGoals[k])}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
              <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2">{current.name} total</td>
              {kpis.map((k) => {
                const e = evaluate(k, kpiValue(totalM, k), myGoals[k], mp);
                return <td key={k} className={`px-3 py-2 text-right ${cellClass(e.status)}`}>{formatKpi(k, kpiValue(totalM, k))}</td>;
              })}
            </tr>
            {rows.map((r) => {
              const g = rowGoals(r);
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2">
                    <Link href={r.href} className="font-medium hover:underline">{r.name}</Link>
                    {r.sub && <span className="block text-xs text-gray-400">{r.sub}</span>}
                  </td>
                  {kpis.map((k) => {
                    const e = evaluate(k, kpiValue(r.m, k), g[k], mp);
                    return (
                      <td key={k} className={`px-3 py-2 text-right ${cellClass(e.status)}`}
                        title={e.target !== undefined ? `${isVolume(k) ? "Should be" : "Target"} ${formatKpi(k, e.target)} · ${Math.round((e.pct ?? 0) * 100)}%` : undefined}>
                        {formatKpi(k, kpiValue(r.m, k))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} noun={level === "rep" ? "reps" : plural(labels[level] ?? "row").toLowerCase()}
        href={(p) => here({ page: String(p) })} />
    </main>
  );
}
