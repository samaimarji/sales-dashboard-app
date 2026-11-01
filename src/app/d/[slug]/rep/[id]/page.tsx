import { notFound, redirect } from "next/navigation";
import CardActions from "@/components/CardActions";
import { ProgressCard } from "@/components/ProgressCard";
import { Crumbs, dailyFromMtd } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { canSeePerson, requireAccess } from "@/lib/auth/access";
import { repGoals } from "@/lib/kpis/goals";
import { CARD_KPIS } from "@/lib/kpis/sets";
import { combineExpr } from "@/lib/kpis/sql";
import { kpiValue, type KpiMap } from "@/lib/kpis/value";
import { unitHref } from "@/lib/links";
import { fmtDate, orgContext } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * Rep progress card: one page per rep, all their stores combined under one name.
 * People hidden from rep views don't have a card.
 */
export default async function RepCard({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const access = await requireAccess(slug, { allowRep: true });
  const { dealer } = access;

  const data = await withDealer(dealer.id, async (sql) => {
    const [person] = await sql<{ id: number; display_name: string; hidden_from_rep_views: boolean; merged_into_id: number | null }[]>`
      select id, display_name, hidden_from_rep_views, merged_into_id from people where id = ${Number(id)}`;
    if (!person) return null;
    if (person.merged_into_id) return { mergedInto: person.merged_into_id } as const;
    if (person.hidden_from_rep_views) return null;
    if (!(await canSeePerson(sql, access, person.id))) return null;
    const ctx0 = await orgContext(sql, null);
    if (!ctx0) return null;
    const { latestIso, mp } = ctx0;

    const stores = await sql<{ store_id: number; code: string; name: string; acts: number }[]>`
      select r.store_id, u.code, u.name, coalesce((r.m ->> 'activations')::numeric, 0)::int as acts
        from rep_daily_mtd r join org_units u on u.id = r.store_id
       where r.person_id = ${person.id} and r.biz_date = ${latestIso}
       order by acts desc, u.code`;
    // Breadcrumbs follow the store where they sold the most.
    const ctx = await orgContext(sql, stores[0]?.store_id ?? null, access.isRepOnly ? undefined : access.roots);
    const [{ m }] = await sql<{ m: KpiMap | null }[]>`
      select ${sql.unsafe(combineExpr([...CARD_KPIS, "sales_per_10_bill_pays", "net_adds"], "m"))} as m
        from rep_daily_mtd where person_id = ${person.id} and biz_date = ${latestIso}`;
    const goals = await repGoals(sql, person.id, latestIso, mp.month);
    const trend = await sql<{ biz_date: Date; v: string | null }[]>`
      select biz_date, sum(coalesce((m ->> 'activations')::numeric, 0)) as v from rep_daily_mtd
       where person_id = ${person.id} and biz_date between ${mp.month} and ${latestIso}
       group by biz_date order by biz_date`;
    const [{ teamM }] = await sql<{ teamM: KpiMap | null }[]>`
      select (select m from org_rollup_daily where org_unit_id = ${stores[0]?.store_id ?? 0} and biz_date = ${latestIso}) as "teamM"`;
    return { person, ctx: ctx ?? ctx0, stores, m, goals, trend, teamM };
  });
  if (!data) notFound();
  if ("mergedInto" in data) redirect(`/d/${slug}/rep/${data.mergedInto}`);
  const { person, ctx, stores, m, goals, trend, teamM } = data;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {!access.isRepOnly && <Crumbs crumbs={ctx.crumbs} labels={ctx.labels} href={(u) => unitHref(slug, u)} />}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Rep progress card · {dealer.name}</div>
          <h1 className="text-2xl font-semibold" style={{ color: dealer.primary_color }}>{person.display_name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {stores.length ? `Store ${stores.map((s) => s.code).join(" + ")}` : "No sales this month"} · Month to date through {fmtDate(ctx.latest)}
          </p>
        </div>
        <CardActions />
      </div>
      <ProgressCard m={m} goals={goals} mp={ctx.mp} trend={dailyFromMtd(trend)} color={dealer.primary_color}
        compareLabel={`Store ${stores[0]?.code ?? ""} average`} compareValue={kpiValue(teamM, "sales_per_10_bill_pays")} />
      <p className="mt-4 text-xs text-gray-500">
        Goals: each store&apos;s monthly goal split evenly among the people selling there{stores.length > 1 ? ", added up across stores" : ""}. Rate targets are the company&apos;s.
      </p>
    </main>
  );
}
