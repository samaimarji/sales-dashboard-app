import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressCard } from "@/components/ProgressCard";
import { Crumbs, dailyFromMtd } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { goalsFor } from "@/lib/kpis/goals";
import { shortLabel } from "@/lib/kpis/sets";
import { formatKpi, kpiValue, type KpiMap } from "@/lib/kpis/value";
import { repHref, unitHref } from "@/lib/links";
import { fmtDate, orgContext } from "@/lib/org";
import { repsUnder } from "@/lib/reps";

export const dynamic = "force-dynamic";

const REP_COLUMNS = ["activations", "upgrades", "accessory_revenue", "chi_orders", "autopay_rate", "protect_rate", "upgrade_plus_rate", "wtr"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default async function StoreCard({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const access = await requireAccess(slug);
  const { dealer } = access;

  const data = await withDealer(dealer.id, async (sql) => {
    const ctx = await orgContext(sql, id, access.roots);
    // Outside the user's part of the tree, orgContext falls back to their own unit: treat as not found.
    if (!ctx || ctx.current.level_key !== "store" || ctx.current.id !== Number(id)) return null;
    const { current, latestIso, mp } = ctx;
    const [store] = await sql<{ address: string | null; city: string | null; hours: Record<string, [string, string]> }[]>`
      select address, city, hours from stores where org_unit_id = ${current.id}`;
    const [{ m, parentM }] = await sql<{ m: KpiMap | null; parentM: KpiMap | null }[]>`
      select (select m from org_rollup_daily where org_unit_id = ${current.id} and biz_date = ${latestIso}) as m,
             (select m from org_rollup_daily where org_unit_id = ${current.parent_id} and biz_date = ${latestIso}) as "parentM"`;
    const goals = (await goalsFor(sql, [current.id], mp.month)).get(current.id) ?? {};
    const trend = await sql<{ biz_date: Date; v: string | null }[]>`
      select biz_date, m ->> 'activations' as v from store_daily_mtd
       where store_id = ${current.id} and biz_date between ${mp.month} and ${latestIso} order by biz_date`;
    const reps = await repsUnder(sql, { path: current.path, date: latestIso, kpis: REP_COLUMNS, sort: "activations", limit: 100, offset: 0 });
    const [{ hidden }] = await sql<{ hidden: number }[]>`
      select count(*)::int as hidden from rep_daily_mtd r join people p on p.id = r.person_id
       where r.store_id = ${current.id} and r.biz_date = ${latestIso} and p.hidden_from_rep_views`;
    const [held] = await sql<{ batch_id: number; carried_from: Date | null }[]>`
      select h.batch_id, h.carried_from from import_held_stores h join import_batches b on b.id = h.batch_id and b.status = 'done'
       where h.store_id = ${current.id} and h.biz_date = ${latestIso} and h.status = 'held'`;
    return { ctx, store, m, parentM, goals, trend, reps, hidden, held };
  });
  if (!data) notFound();
  const { ctx, store, m, parentM, goals, trend, reps, hidden, held } = data;
  const { current, crumbs, labels, mp } = ctx;
  const parent = crumbs[crumbs.length - 2];
  const hours = store?.hours ?? {};

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Crumbs crumbs={crumbs} labels={labels} href={(u) => unitHref(slug, u)} />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold" style={{ color: dealer.primary_color }}>
          {current.code} {current.name} <span className="text-base font-normal text-gray-500">Store card</span>
        </h1>
        <Link href={`/d/${slug}/report?unit=${current.id}&level=rep`} className="text-sm text-gray-500 hover:underline print:hidden">KPI report for this store →</Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Month to date through {fmtDate(ctx.latest)} · Net adds {formatKpi("net_adds", kpiValue(m, "net_adds"))} · {reps.length} rep{reps.length === 1 ? "" : "s"}
        {store?.address ? ` · ${store.address}${store.city ? `, ${store.city}` : ""}` : ""}
      </p>
      {DAYS.some((d) => hours[d]) && (
        <p className="mt-0.5 text-xs text-gray-500">
          Hours: Mon–Sat {hours.mon?.[0]}–{hours.mon?.[1]}, Sun {hours.sun?.[0]}–{hours.sun?.[1]}
        </p>
      )}
      {held && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          On hold: the latest files for this store didn&apos;t match, so these are the numbers through{" "}
          {held.carried_from ? fmtDate(held.carried_from) : "the last good day"}.{" "}
          <Link href={`/d/${slug}/imports/${held.batch_id}`} className="font-medium underline">Review</Link>
        </div>
      )}

      <ProgressCard m={m} goals={goals} mp={mp} trend={dailyFromMtd(trend)} color={dealer.primary_color}
        compareLabel={`${parent ? labels[parent.level_key] : "Company"} average`} compareValue={kpiValue(parentM, "sales_per_10_bill_pays")} />

      <h2 className="mt-8 text-lg font-semibold">Reps at this store</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Rep</th>
              {REP_COLUMNS.map((k) => <th key={k} className="px-3 py-2 text-right">{shortLabel(k)}</th>)}
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.person_id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link href={repHref(slug, r.person_id)} className="font-medium hover:underline">{r.display_name}</Link>
                </td>
                {REP_COLUMNS.map((k) => <td key={k} className="px-3 py-2 text-right">{formatKpi(k, kpiValue(r.m, k))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Numbers here are each rep&apos;s sales at this store.{hidden > 0 ? ` Store totals also include ${hidden} person not shown in rep lists.` : ""}
      </p>
    </main>
  );
}
