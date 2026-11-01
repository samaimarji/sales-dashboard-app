import { KpiTile, ProgressBar, StatusPill, TrendBars } from "@/components/ui";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";
import { evaluate, STATUS_LABEL, type MonthProgress } from "@/lib/kpis/pace";
import { CARD_KPIS } from "@/lib/kpis/sets";
import { formatKpi, isVolume, kpiValue, type KpiMap } from "@/lib/kpis/value";

const HEADLINE = ["activations", "upgrades", "accessory_revenue", "upgrade_plus_rate"];

/**
 * The store/rep progress card: headline numbers, every KPI against today's pace,
 * traffic, and where the month ends at this pace. Same layout as the Store Card sheet.
 */
export function ProgressCard({ m, goals, mp, trend, color, compareLabel, compareValue }: {
  m: KpiMap | null;
  goals: Record<string, number>;
  mp: MonthProgress;
  trend: { date: string; value: number }[];
  color: string;
  compareLabel: string;
  compareValue: number | undefined;
}) {
  const evals = CARD_KPIS.map((k) => ({ k, e: evaluate(k, kpiValue(m, k), goals[k], mp) }));
  const tracked = evals.filter(({ e }) => e.status !== "none");
  const onTarget = tracked.filter(({ e }) => e.status === "on" || e.status === "ahead").length;
  const per10 = kpiValue(m, "sales_per_10_bill_pays");

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {HEADLINE.map((k) => <KpiTile key={k} code={k} e={evaluate(k, kpiValue(m, k), goals[k], mp)} />)}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">KPIs on target</div>
          <div className="mt-1 text-2xl font-semibold">{onTarget} of {tracked.length}</div>
          <div className="mt-1 text-xs text-gray-500">tracked this month</div>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">KPI</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Should be today</th>
              <th className="px-3 py-2 text-right">Monthly goal</th>
              <th className="w-48 px-3 py-2">Progress to today&apos;s target</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {evals.map(({ k, e }) => (
              <tr key={k} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{KPI_BY_CODE[k].label}</td>
                <td className="px-3 py-2 text-right">{formatKpi(k, e.actual ?? kpiValue(m, k))}</td>
                <td className="px-3 py-2 text-right text-gray-600">{formatKpi(k, e.target)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{formatKpi(k, e.goal)}</td>
                <td className="px-3 py-2"><ProgressBar e={e} /></td>
                <td className="px-3 py-2"><StatusPill status={e.status} pct={e.pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2"><TrendBars days={trend} code="activations" color={color} /></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <div className="font-medium">Traffic</div>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-gray-600">Bill payments</dt><dd className="text-right font-medium">{formatKpi("bill_payments", kpiValue(m, "bill_payments"))}</dd>
            <dt className="text-gray-600">Sales per 10 bill payments</dt><dd className="text-right font-medium">{formatKpi("sales_per_10_bill_pays", per10)}</dd>
            <dt className="text-gray-600">{compareLabel}</dt><dd className="text-right font-medium">{formatKpi("sales_per_10_bill_pays", compareValue)}</dd>
          </dl>
          <p className="mt-2 text-xs text-gray-500">Boxes (activations + upgrades) for every 10 customers who came in to pay a bill.</p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Trending: where the month ends at this pace</h2>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        {["activations", "accessory_revenue"].map((k) => {
          const e = evaluate(k, kpiValue(m, k), goals[k], mp);
          if (e.goal === undefined || !isVolume(k)) return null;
          const finishPct = e.projected !== undefined ? e.projected / e.goal : undefined;
          return (
            <div key={k} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <div className="font-medium">{KPI_BY_CODE[k].label}</div>
              <div className="mt-1 text-2xl font-semibold">
                {formatKpi(k, e.projected)} <span className="text-base font-normal text-gray-500">of {formatKpi(k, e.goal)}</span>
              </div>
              <p className="mt-1 text-gray-600">
                {finishPct !== undefined && finishPct >= 1
                  ? `${STATUS_LABEL.on.split(" ")[0]} On track to finish at ${Math.round(finishPct * 100)}% of goal. Keep the pace.`
                  : `${STATUS_LABEL.behind.split(" ")[0]} Trending to ${Math.round((finishPct ?? 0) * 100)}% of goal.` +
                    (e.neededPerDay !== undefined ? ` Needs ${formatKpi(k, e.neededPerDay)} a day for the last ${mp.daysLeft} day${mp.daysLeft === 1 ? "" : "s"}.` : "")}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Projection = month to date ÷ share of the month gone ({Math.round(mp.share * 100)}%). Early in the month it swings a lot; it gets more reliable each day.
      </p>
    </>
  );
}
