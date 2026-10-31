import type postgres from "postgres";
import { combine, type Kpis, type MergedDay } from "./merge";

type Tx = postgres.TransactionSql;

const storeNameOf = (location: string) =>
  location.replace(/^\d+\s*[:\-–]\s*/, "").trim() || location;

interface ResolvedPeople {
  /** repRaw -> person id */
  byRaw: Map<string, number>;
  created: number;
}

/** Finds people for every rep name in the files (alias first, then employee ID); adds anyone new. */
async function resolvePeople(sql: Tx, dealerId: number, merged: MergedDay, dryRun: boolean): Promise<ResolvedPeople> {
  const raws = [...new Set(merged.repRows.map((r) => r.repRaw))];
  const byRaw = new Map<string, number>();
  for (const a of await sql<{ raw_name: string; person_id: number }[]>`
      select raw_name, person_id from person_aliases where raw_name = any(${raws})`) byRaw.set(a.raw_name, a.person_id);

  // Employee IDs are matched ignoring upper/lower case ("AB1234" = "ab1234").
  const code = (r: { repCode: string | null }) => r.repCode?.toLowerCase() ?? null;
  const missing = merged.repRows.filter((r) => !byRaw.has(r.repRaw));
  const codes = [...new Set(missing.map(code).filter((c): c is string => !!c))];
  const byCode = new Map<string, number>();
  if (codes.length) {
    for (const p of await sql<{ id: number; code: string }[]>`
        select id, lower(employee_code) as code from people where lower(employee_code) = any(${codes})`) byCode.set(p.code, p.id);
  }

  const toCreate = new Map<string, { display_name: string; employee_code: string | null }>();
  for (const r of missing) {
    const c = code(r);
    if (c && byCode.has(c)) continue;
    toCreate.set(c ?? `raw:${r.repRaw}`, { display_name: r.repName, employee_code: r.repCode });
  }
  if (dryRun) return { byRaw, created: toCreate.size };

  if (toCreate.size) {
    const rows = [...toCreate.values()].map((p) => ({ ...p, dealer_id: dealerId, auto_added: true }));
    const made = await sql<{ id: number; employee_code: string | null; display_name: string }[]>`
      insert into people ${sql(rows, "dealer_id", "display_name", "employee_code", "auto_added")}
      returning id, employee_code, display_name`;
    for (const p of made) {
      if (p.employee_code) byCode.set(p.employee_code.toLowerCase(), p.id);
      else for (const r of missing) if (!r.repCode && r.repName === p.display_name) byRaw.set(r.repRaw, p.id);
    }
  }
  const newAliases: { dealer_id: number; raw_name: string; person_id: number }[] = [];
  for (const r of missing) {
    const c = code(r);
    const id = byRaw.get(r.repRaw) ?? (c ? byCode.get(c) : undefined);
    if (id === undefined) continue;
    if (!byRaw.has(r.repRaw)) byRaw.set(r.repRaw, id);
    newAliases.push({ dealer_id: dealerId, raw_name: r.repRaw, person_id: id });
  }
  const uniqueAliases = [...new Map(newAliases.map((a) => [a.raw_name, a])).values()];
  if (uniqueAliases.length) await sql`insert into person_aliases ${sql(uniqueAliases)} on conflict do nothing`;
  return { byRaw, created: toCreate.size };
}

/** What saving would add, shown on the review screen before anything is written. */
export async function previewNewRecords(sql: Tx, dealerId: number, merged: MergedDay) {
  const storeNumbers = [...new Set([...merged.storeLocations.keys()])];
  const known = new Set((await sql<{ store_number: string }[]>`
    select store_number from stores where store_number = any(${storeNumbers})`).map((s) => s.store_number));
  const newStores = storeNumbers.filter((s) => !known.has(s));
  const { created } = await resolvePeople(sql, dealerId, merged, true);
  return { newStores, newPeople: created };
}

/**
 * Writes one day. Anything already saved for that date is replaced, so uploading the
 * same day twice never doubles the numbers.
 */
export async function saveDay(sql: Tx, dealerId: number, batchId: number, bizDate: string, merged: MergedDay) {
  const [root] = await sql<{ id: number; path: string }[]>`
    select id, path::text from org_units where level_key = 'dealer'`;

  // 1. Stores: look up by store number; add unknown ones under the company level.
  const storeNumbers = [...merged.storeLocations.keys()];
  const storeId = new Map<string, number>();
  for (const s of await sql<{ store_number: string; org_unit_id: number }[]>`
      select store_number, org_unit_id from stores where store_number = any(${storeNumbers})`) storeId.set(s.store_number, s.org_unit_id);
  const newStores = storeNumbers.filter((n) => !storeId.has(n));
  if (newStores.length) {
    const units = await sql<{ id: number; code: string }[]>`
      insert into org_units ${sql(newStores.map((n) => ({
        dealer_id: dealerId, parent_id: root.id, level_key: "store", name: storeNameOf(merged.storeLocations.get(n)!),
        code: n, path: root.path, auto_added: true,
      })))}
      returning id, code`;
    await sql`update org_units set path = ${root.path}::ltree || text2ltree('u' || id) where id = any(${units.map((u) => u.id)})`;
    await sql`insert into stores ${sql(units.map((u) => ({ org_unit_id: u.id, dealer_id: dealerId, store_number: u.code })))}`;
    for (const u of units) storeId.set(u.code, u.id);
  }

  // 2. People: combine every spelling of a person into one id.
  const { byRaw, created } = await resolvePeople(sql, dealerId, merged, false);

  // 3. Rep rows per (store, person). A person listed twice at a store is added together.
  const grouped = new Map<string, { store_id: number; person_id: number; maps: Kpis[] }>();
  for (const r of merged.repRows) {
    const store_id = storeId.get(r.storeNumber)!;
    const person_id = byRaw.get(r.repRaw)!;
    const key = `${store_id}|${person_id}`;
    const g = grouped.get(key) ?? grouped.set(key, { store_id, person_id, maps: [] }).get(key)!;
    g.maps.push(r.m);
  }
  const pairs = [...grouped.values()];
  if (pairs.length) {
    await sql`
      insert into store_assignments (dealer_id, person_id, store_id, is_primary, start_date)
      select ${dealerId}, p.person_id, p.store_id, false, ${bizDate}::date
        from unnest(${pairs.map((p) => p.person_id)}::int[], ${pairs.map((p) => p.store_id)}::int[]) as p(person_id, store_id)
       where not exists (select 1 from store_assignments a where a.person_id = p.person_id and a.store_id = p.store_id)`;
  }

  // 4. Replace the day.
  await sql`update import_batches set status = 'replaced' where biz_date = ${bizDate} and status = 'done' and id <> ${batchId}`;
  await sql`delete from rep_daily_mtd where biz_date = ${bizDate}`;
  await sql`delete from store_daily_mtd where biz_date = ${bizDate}`;

  const repRows = pairs.map((p) => ({
    dealer_id: dealerId, biz_date: bizDate, store_id: p.store_id, person_id: p.person_id,
    m: sql.json(combine(p.maps)), import_batch_id: batchId,
  }));
  for (let i = 0; i < repRows.length; i += 2000) await sql`insert into rep_daily_mtd ${sql(repRows.slice(i, i + 2000))}`;

  const storeRows = [...merged.storeRows].map(([n, m]) => ({
    dealer_id: dealerId, biz_date: bizDate, store_id: storeId.get(n)!, m: sql.json({ open_stores: 1, ...m }), import_batch_id: batchId,
  }));
  for (let i = 0; i < storeRows.length; i += 2000) await sql`insert into store_daily_mtd ${sql(storeRows.slice(i, i + 2000))}`;

  // 5. Goals from the files, for the month of this date.
  const month = bizDate.slice(0, 8) + "01";
  const goals = merged.goals
    .filter((g) => storeId.has(g.storeNumber))
    .map((g) => ({ dealer_id: dealerId, org_unit_id: storeId.get(g.storeNumber)!, month, kpi_code: g.kpi, target: g.target, source: "import", goal_set: g.goalSet }));
  const uniqueGoals = [...new Map(goals.map((g) => [`${g.org_unit_id}|${g.kpi_code}|${g.goal_set}`, g])).values()];
  for (let i = 0; i < uniqueGoals.length; i += 2000) {
    await sql`
      insert into kpi_goals ${sql(uniqueGoals.slice(i, i + 2000))}
      on conflict (dealer_id, org_unit_id, month, kpi_code, goal_set)
      do update set target = excluded.target, source = 'import'`;
  }

  // 6. Pre-added totals for every org level.
  await sql`select refresh_rollups(${dealerId}, ${bizDate}::date, ${bizDate}::date)`;

  return { reps: repRows.length, stores: storeRows.length, newStores: newStores.length, newPeople: created, goals: uniqueGoals.length };
}
