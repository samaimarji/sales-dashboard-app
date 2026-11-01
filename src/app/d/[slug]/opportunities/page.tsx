import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs, Pager, cellClass } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { goalsFor } from "@/lib/kpis/goals";
import { statusOf } from "@/lib/kpis/pace";
import { OPPORTUNITIES } from "@/lib/kpis/sets";
import { missedExpr } from "@/lib/kpis/sql";
import { formatKpi, kpiValue, type KpiMap } from "@/lib/kpis/value";
import { repHref, withParams } from "@/lib/links";
import { fmtDate, orgContext, unitName } from "@/lib/org";
import { repsUnder } from "@/lib/reps";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

const missed = (m: KpiMap | null, o: (typeof OPPORTUNITIES)[number]) =>
  Math.max(0, (kpiValue(m, o.chances) ?? 0) - (kpiValue(m, o.sold) ?? 0));
const totalMissed = (m: KpiMap | null) => OPPORTUNITIES.reduce((a, o) => a + missed(m, o), 0);
const OPP_KPIS = OPPORTUNITIES.flatMap((o) => [o.chances, o.sold, o.rate]);

/** Missed chances: customers already at the counter who left without the product. */
export default async function Opportunities({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ unit?: string; page?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const access = await requireAccess(slug);
  const { dealer } = access;
  const page = Math.max(1, Number(sp.page) || 1);

  const data = await withDealer(dealer.id, async (sql) => {
    const ctx = await orgContext(sql, sp.unit, access.roots);
    if (!ctx) return null;
    const { current, latestIso, mp } = ctx;
    const [{ m }] = await sql<{ m: KpiMap | null }[]>`
      select (select m from org_rollup_daily where org_unit_id = ${current.id} and biz_date = ${latestIso}) as m`;
    const goals = (await goalsFor(sql, [current.id], mp.month)).get(current.id) ?? {};
    const order = missedExpr(OPPORTUNITIES, "r.m");

    // Rows: the units one level down, or the reps when looking at a store.
    let rows: { id: number; name: string; href: string; m: KpiMap; total: number }[];
    if (current.level_key === "store") {
      const reps = await repsUnder(sql, { path: current.path, date: latestIso, kpis: OPP_KPIS, sort: "activations", orderExpr: (c) => missedExpr(OPPORTUNITIES, c), limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      rows = reps.map((r) => ({ id: r.person_id, name: r.display_name, href: repHref(slug, r.person_id), m: r.m, total: r.total }));
    } else {
      const units = await sql<{ id: number; name: string; code: string | null; level_key: string; m: KpiMap; total: number }[]>`
        select u.id, u.name, u.code, u.level_key, r.m, count(*) over ()::int as total
          from org_units u join org_rollup_daily r on r.org_unit_id = u.id and r.biz_date = ${latestIso}
         where u.parent_id = ${current.id}
         order by ${sql.unsafe(order)} desc nulls last, u.name
         limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
      rows = units.map((u) => ({ id: u.id, name: unitName(u), href: withParams(`/d/${slug}/opportunities`, { unit: u.id }), m: u.m, total: u.total }));
    }
    const [topRep] = await repsUnder(sql, { path: current.path, date: latestIso, kpis: OPP_KPIS, sort: "activations", orderExpr: (c) => missedExpr(OPPORTUNITIES, c), limit: 1, offset: 0 });
    return { ctx, m, goals, rows, topRep };
  });
  if (!data) notFound();
  const { ctx, m, goals, rows, topRep } = data;
  const { current, crumbs, labels } = ctx;
  const total = rows[0]?.total ?? 0;
  const pppFunded = kpiValue(m, "ppp_funded") ?? 0;
  const pppLinks = kpiValue(m, "ppp_links_sent") ?? 0;
  const worst = page === 1 ? rows[0] : undefined;
  const childLabel = current.level_key === "store" ? "rep" : labels[ctx.levels[ctx.levels.indexOf(current.level_key) + 1] ?? "store"];

  const card = (title: string, big: string, sub: string) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{big}</div>
      <div className="mt-1 text-xs text-gray-500">{sub}</div>
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Crumbs crumbs={crumbs} labels={labels} href={(u) => withParams(`/d/${slug}/opportunities`, { unit: u.id })} />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Missed chances &amp; financing</h1>
        <span className="text-sm text-gray-500">Month to date through {fmtDate(ctx.latest)}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">Every number on this page is a customer who was already at the counter.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {card("Missed chances this month", formatKpi("boxes", totalMissed(m)),
          worst ? `Most: ${worst.name} (${formatKpi("boxes", totalMissed(worst.m))})` : "")}
        {card("CHI address checks", `${formatKpi("boxes", kpiValue(m, "chi_addresses_checked"))} / ${formatKpi("boxes", kpiValue(m, "bill_payments"))}`,
          `${formatKpi("chi_check_rate", kpiValue(m, "chi_check_rate"))} of bill payments checked`)}
        {card("ILD sold", `${formatKpi("boxes", kpiValue(m, "ild_adds"))} / ${formatKpi("boxes", kpiValue(m, "ild_opps"))}`,
          `${formatKpi("ild_rate", kpiValue(m, "ild_rate"))} of ILD chances${goals.ild_rate ? ` · target ${formatKpi("ild_rate", goals.ild_rate)}` : ""}`)}
        {card("PPP leases funded", `${formatKpi("boxes", pppFunded)} / ${formatKpi("boxes", pppLinks)}`,
          `${formatKpi("boxes", Math.max(0, pppLinks - pppFunded))} applicants still waiting for a call back`)}
      </div>
      {topRep && <p className="mt-3 text-sm text-gray-600">Most missed chances (rep): <Link href={repHref(slug, topRep.person_id)} className="font-medium hover:underline">{topRep.display_name}</Link> ({formatKpi("boxes", totalMissed(topRep.m))})</p>}

      <h2 className="mt-8 text-lg font-semibold">Where each {childLabel.toLowerCase()} is leaving sales on the table</h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">{current.level_key === "store" ? "Rep" : "Name"}</th>
              {OPPORTUNITIES.map((o) => (
                <th key={o.key} className="px-3 py-2 text-right">{o.label}{goals[o.rate] ? <span className="block font-normal normal-case">target {formatKpi(o.rate, goals[o.rate])}</span> : null}</th>
              ))}
              <th className="px-3 py-2 text-right">Total missed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2"><Link href={r.href} className="font-medium hover:underline">{r.name}</Link></td>
                {OPPORTUNITIES.map((o) => {
                  const rate = kpiValue(r.m, o.rate);
                  const target = goals[o.rate];
                  return (
                    <td key={o.key} className={`px-3 py-2 text-right ${target ? cellClass(statusOf(rate !== undefined ? rate / target : undefined)) : ""}`}>
                      <div className="font-medium">{formatKpi(o.rate, rate)}</div>
                      <div className="text-xs opacity-75">{formatKpi("boxes", missed(r.m, o))} missed</div>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right text-base font-semibold">{formatKpi("boxes", totalMissed(r.m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} noun={current.level_key === "store" ? "reps" : "items"}
        href={(p) => withParams(`/d/${slug}/opportunities`, { unit: current.id, page: p })} />
      <p className="mt-3 text-xs text-gray-500">
        Missed = chances − sold. CHI&apos;s chances are bill payments (goal: check an address for every customer paying a bill). Sorted by most missed.
      </p>
    </main>
  );
}
