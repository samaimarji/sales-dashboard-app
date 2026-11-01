import { Pager } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";
import { formatKpi, kpiValue, type KpiMap } from "@/lib/kpis/value";
import { withParams } from "@/lib/links";
import { fmtDate } from "@/lib/org";
import { copyGoals, saveGoals } from "../actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const GOAL_KPIS = ["activations", "upgrades", "accessory_revenue", "chi_orders"];
type Search = { month?: string; q?: string; page?: string };

const monthLabel = (m: string) => fmtDate(m, { month: "long", year: "numeric" });
const addMonths = (m: string, n: number) => {
  const d = new Date(m + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** Monthly store goals. District, region and company goals are these added up. */
export default async function GoalSettings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { dealer } = await requireAccess(slug, { admin: true });
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().toLowerCase();

  const data = await withDealer(dealer.id, async (sql) => {
    const [{ latest }] = await sql<{ latest: Date | null }[]>`select max(biz_date) as latest from org_rollup_daily`;
    const dataMonth = (latest ?? new Date()).toISOString().slice(0, 8) + "01";
    const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") ? sp.month! : dataMonth;
    const search = q ? sql`and lower(u.name || ' ' || coalesce(u.code, '')) like ${"%" + q + "%"}` : sql``;
    const stores = await sql<{ id: number; code: string; name: string; district: string | null; goals: Record<string, string> | null; m: KpiMap | null; total: number }[]>`
      select u.id, u.code, u.name, d.name as district,
             (select jsonb_object_agg(g.kpi_code, g.target) from kpi_goals g
               where g.org_unit_id = u.id and g.month = ${month} and g.goal_set = 'dealer') as goals,
             (select r.m from org_rollup_daily r where r.org_unit_id = u.id and r.biz_date = ${latest}) as m,
             count(*) over ()::int as total
        from org_units u left join org_units d on d.id = u.parent_id
       where u.level_key = 'store' ${search}
       order by u.code limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from kpi_goals g join org_units u on u.id = g.org_unit_id
                                                where g.month = ${month} and g.goal_set = 'dealer' and u.level_key = 'store'`;
    return { stores, month, dataMonth, latest, goalsThisMonth: n };
  });
  const { stores, month, dataMonth, latest, goalsThisMonth } = data;
  const total = stores[0]?.total ?? 0;
  const months = [-2, -1, 0, 1].map((n) => addMonths(dataMonth, n));
  const showActual = month === dataMonth;

  return (
    <div>
      <p className="text-sm text-gray-600">
        Monthly goals for each store. Districts, regions and the company add these up. Goals that arrive in the MTD file fill in automatically;
        a goal you type here wins over the file. Leave a box empty for no goal.
      </p>
      <form className="mt-4 flex flex-wrap items-center gap-2" action={`/d/${slug}/settings/goals`}>
        <select name="month" defaultValue={month} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Store name or #" className="w-56 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm" />
        <button className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Show</button>
      </form>

      {goalsThisMonth === 0 && (
        <form action={copyGoals} className="mt-3 flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="from" value={addMonths(month, -1)} />
          <input type="hidden" name="to" value={month} />
          No goals for {monthLabel(month)} yet.
          <button className="rounded-md bg-white px-3 py-1 font-medium ring-1 ring-amber-300">Copy {monthLabel(addMonths(month, -1))}&apos;s goals</button>
        </form>
      )}

      <form action={saveGoals} className="mt-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="month" value={month} />
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Store</th>
                {GOAL_KPIS.map((k) => <th key={k} className="px-3 py-2">{KPI_BY_CODE[k].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-3 py-1.5"><span className="font-medium">{s.code} · {s.name}</span>
                    <span className="block text-xs text-gray-400">{s.district}</span></td>
                  {GOAL_KPIS.map((k) => {
                    const v = s.goals?.[k] !== undefined ? String(Number(s.goals[k])) : "";
                    return (
                      <td key={k} className="px-3 py-1.5">
                        <input type="hidden" name={`was:${s.id}:${k}`} value={v} />
                        <input name={`g:${s.id}:${k}`} defaultValue={v} inputMode="decimal" aria-label={`${s.code} ${KPI_BY_CODE[k].label} goal`}
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right" />
                        {showActual && <span className="ml-2 text-xs text-gray-400">{formatKpi(k, kpiValue(s.m, k))} so far</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Save goals on this page</button>
          {showActual && latest && <span className="text-xs text-gray-500">&quot;So far&quot; = month to date through {fmtDate(latest)}.</span>}
        </div>
      </form>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} noun="stores"
        href={(p) => withParams(`/d/${slug}/settings/goals`, { month, q: sp.q, page: p })} />
    </div>
  );
}
