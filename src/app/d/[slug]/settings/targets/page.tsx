import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";
import { fmtDate } from "@/lib/org";
import { saveRateTargets } from "../actions";

export const dynamic = "force-dynamic";

const TARGET_KPIS = [
  "autopay_rate", "protect_rate", "upgrade_plus_rate", "ild_rate", "hotspot_rate", "multiline_pct", "add_a_line_pct",
  "max_attach_rate", "wtr", "chi_check_rate", "act_fees_waived_rate", "upg_fees_waived_rate", "sales_per_10_bill_pays",
];

/** Company-wide targets for rates. A target stays in effect for later months until it's changed. */
export default async function TargetSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dealer = (await getDealer(slug))!;
  const data = await withDealer(dealer.id, async (sql) => {
    const [{ latest }] = await sql<{ latest: Date | null }[]>`select max(biz_date) as latest from org_rollup_daily`;
    const month = (latest ?? new Date()).toISOString().slice(0, 8) + "01";
    const [root] = await sql<{ id: number }[]>`select id from org_units where level_key = 'dealer'`;
    const rows = await sql<{ kpi_code: string; target: string; month: Date }[]>`
      select distinct on (kpi_code) kpi_code, target, month from kpi_goals
       where org_unit_id = ${root.id} and goal_set = 'dealer' and month <= ${month}
       order by kpi_code, month desc`;
    return { month, rootId: root.id, current: new Map(rows.map((r) => [r.kpi_code, { target: Number(r.target), month: r.month }])) };
  });
  const shown = (code: string) => {
    const t = data.current.get(code)?.target;
    if (t === undefined) return "";
    return KPI_BY_CODE[code].unit === "percent" ? String(Math.round(t * 1000) / 10) : String(t);
  };

  return (
    <form action={saveRateTargets} className="max-w-2xl">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="month" value={data.month} />
      <input type="hidden" name="rootId" value={data.rootId} />
      <p className="text-sm text-gray-600">
        Targets for rates, for every store and rep. Type a percent (75 = 75%). Changes start in {fmtDate(data.month, { month: "long", year: "numeric" })} and stay
        until you change them again. Leave empty for no target.
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-2">KPI</th><th className="px-4 py-2">Target</th><th className="px-4 py-2">Lower is better?</th></tr>
          </thead>
          <tbody>
            {TARGET_KPIS.map((k) => (
              <tr key={k} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{KPI_BY_CODE[k].label}<span className="block text-xs font-normal text-gray-400">{KPI_BY_CODE[k].description}</span></td>
                <td className="px-4 py-2">
                  <input type="hidden" name={`was:${k}`} value={shown(k)} />
                  <input name={`t:${k}`} defaultValue={shown(k)} inputMode="decimal" aria-label={`${KPI_BY_CODE[k].label} target`}
                    className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right" />
                  <span className="ml-1 text-gray-500">{KPI_BY_CODE[k].unit === "percent" ? "%" : ""}</span>
                </td>
                <td className="px-4 py-2 text-gray-500">{KPI_BY_CODE[k].higherIsBetter ? "" : "Yes: under target is good"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="mt-3 rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Save targets</button>
    </form>
  );
}
