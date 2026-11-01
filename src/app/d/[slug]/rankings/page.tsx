import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs, Pager, StatusPill } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";
import { statusOf } from "@/lib/kpis/pace";
import { RANKING_KPIS } from "@/lib/kpis/sets";
import { valueExpr } from "@/lib/kpis/sql";
import { formatKpi, isVolume, kpiValue, type KpiMap } from "@/lib/kpis/value";
import { repHref, unitHref, withParams } from "@/lib/links";
import { fmtDate, orgContext, plural, unitName } from "@/lib/org";
import { repsUnder } from "@/lib/reps";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type Search = { unit?: string; level?: string; kpi?: string; by?: string; page?: string };

/** Minimum chances before a rep is ranked on a rate (so 1 for 1 isn't "100%"). */
const MIN_CHANCES = 10;

export default async function Rankings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const dealer = await getDealer(slug);
  if (!dealer) notFound();
  const kpi = sp.kpi && RANKING_KPIS.includes(sp.kpi) ? sp.kpi : "activations";
  const page = Math.max(1, Number(sp.page) || 1);

  const data = await withDealer(dealer.id, async (sql) => {
    const ctx = await orgContext(sql, sp.unit);
    if (!ctx) return null;
    const { current, levels, latestIso, mp } = ctx;
    const below = levels.slice(levels.indexOf(current.level_key) + 1);
    const levelOptions = [...below, "rep"];
    const level = sp.level && levelOptions.includes(sp.level) ? sp.level : levelOptions[Math.max(0, levelOptions.indexOf("store"))];
    // "% of today's target" ranking needs goals, so only volume KPIs at org levels.
    const byPace = sp.by === "pace" && isVolume(kpi) && level !== "rep";

    if (level === "rep") {
      const k = KPI_BY_CODE[kpi];
      const minChances = k.agg === "ratio" ? { code: k.denominator!, min: MIN_CHANCES }
        : k.agg === "weighted_avg" ? { code: k.weightKpi!, min: MIN_CHANCES } : undefined;
      const reps = await repsUnder(sql, { path: current.path, date: latestIso, kpis: [kpi], sort: kpi, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, minChances });
      return { ctx, level, levelOptions, byPace, rows: reps.map((r) => ({ id: r.person_id, name: r.display_name, sub: `Store ${r.stores}`, href: repHref(slug, r.person_id), m: r.m, rank: r.rank, total: r.total, pct: undefined as number | undefined })) };
    }

    const value = valueExpr(kpi, "r.m");
    const goal = sql`(select sum(g.target) from kpi_goals g join org_units st on st.id = g.org_unit_id
                       where st.path <@ u.path and g.kpi_code = ${kpi} and g.month = ${mp.month} and g.goal_set = 'dealer')`;
    const rows = await sql<{ id: number; name: string; code: string | null; level_key: string; parent: string | null; m: KpiMap; pct: string | null; rank: number; total: number }[]>`
      with x as (
        select u.id, u.name, u.code, u.level_key, p.name as parent, r.m,
               ${byPace ? sql`${sql.unsafe(value)} / nullif(${goal} * ${mp.share}, 0)` : sql`null::numeric`} as pct,
               ${sql.unsafe(value)} as v
          from org_units u
          join org_rollup_daily r on r.org_unit_id = u.id and r.biz_date = ${latestIso}
          left join org_units p on p.id = u.parent_id
         where u.level_key = ${level} and u.path <@ ${current.path}::ltree
      )
      select x.id, x.name, x.code, x.level_key, x.parent, x.m, x.pct,
             rank() over (order by ${byPace ? sql`x.pct` : sql`x.v`} desc nulls last)::int as rank, count(*) over ()::int as total
        from x order by ${byPace ? sql`x.pct` : sql`x.v`} desc nulls last, x.name
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
    return { ctx, level, levelOptions, byPace, rows: rows.map((r) => ({ id: r.id, name: unitName(r), sub: r.parent ?? "", href: unitHref(slug, r), m: r.m, rank: r.rank, total: r.total, pct: r.pct === null ? undefined : Number(r.pct) })) };
  });
  if (!data) notFound();
  const { ctx, level, levelOptions, byPace, rows } = data;
  const { current, crumbs, labels } = ctx;
  const total = rows[0]?.total ?? 0;
  const here = (o: Partial<Search>) => withParams(`/d/${slug}/rankings`, { unit: current.id, level, kpi, by: byPace ? "pace" : undefined, ...o });
  const levelName = (l: string) => (l === "rep" ? "Reps" : plural(labels[l]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Crumbs crumbs={crumbs} labels={labels} href={(u) => withParams(`/d/${slug}/rankings`, { unit: u.id, kpi, level: u.level_key === "store" ? "rep" : undefined })} />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Rankings</h1>
        <span className="text-sm text-gray-500">Month to date through {fmtDate(ctx.latest)} · within {current.name}</span>
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm" action={`/d/${slug}/rankings`}>
        <input type="hidden" name="unit" value={current.id} />
        <label>Rank<select name="level" defaultValue={level} className="ml-2 rounded-md border border-gray-300 px-2 py-1">
          {levelOptions.map((l) => <option key={l} value={l}>{levelName(l)}</option>)}
        </select></label>
        <label>by<select name="kpi" defaultValue={kpi} className="ml-2 rounded-md border border-gray-300 px-2 py-1">
          {RANKING_KPIS.map((k) => <option key={k} value={k}>{KPI_BY_CODE[k].label}</option>)}
        </select></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="by" value="pace" defaultChecked={byPace} />% of today&apos;s goal (not reps)</label>
        <button className="rounded-md px-3 py-1.5 font-medium text-white" style={{ background: dealer.primary_color }}>Show</button>
      </form>
      {level === "rep" && !isVolume(kpi) && <p className="mt-2 text-xs text-gray-500">Reps need at least {MIN_CHANCES} chances to be ranked on a rate.</p>}

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="w-16 px-4 py-2">Rank</th><th className="px-3 py-2">{level === "rep" ? "Rep" : labels[level]}</th>
              <th className="px-3 py-2 text-right">{KPI_BY_CODE[kpi].label}</th>{byPace && <th className="px-3 py-2">vs today&apos;s goal</th>}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-semibold">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
                <td className="px-3 py-2"><Link href={r.href} className="font-medium hover:underline">{r.name}</Link>
                  {r.sub && <span className="ml-2 text-xs text-gray-400">{r.sub}</span>}</td>
                <td className="px-3 py-2 text-right font-medium">{formatKpi(kpi, kpiValue(r.m, kpi))}</td>
                {byPace && <td className="px-3 py-2"><StatusPill status={statusOf(r.pct)} pct={r.pct} /></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Nothing to rank yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} noun="ranked" href={(p) => here({ page: String(p) })} />
    </main>
  );
}
