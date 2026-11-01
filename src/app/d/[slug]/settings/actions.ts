"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type postgres from "postgres";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { KPI_BY_CODE, STORED_KPIS } from "@/lib/kpis/catalog";
import { combineExpr } from "@/lib/kpis/sql";

/**
 * Settings changes: dealer admins only. Every change is written to the audit log
 * ("Change history") with who made it.
 */

type Actor = { id: number; slug: string; name: string; userId: number };

async function dealerFrom(form: FormData): Promise<Actor> {
  const access = await requireAccess(String(form.get("slug")), { admin: true });
  return { id: access.dealer.id, slug: access.dealer.slug, name: access.dealer.name, userId: access.user.id };
}

async function audit(sql: postgres.TransactionSql, actor: Actor, action: string, entity: string, entityId: string | number | null, details: object) {
  await sql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
            values (${actor.id}, ${actor.userId}, ${action}, ${entity}, ${entityId === null ? null : String(entityId)}, ${sql.json(details as never)})`;
}

// ---------------------------------------------------------------------------
// People: hide from rep views, combine records
// ---------------------------------------------------------------------------

export async function setHidden(form: FormData) {
  const dealer = await dealerFrom(form);
  const personId = Number(form.get("personId"));
  const hidden = form.get("hidden") === "true";
  await withDealer(dealer.id, async (sql) => {
    const [p] = await sql<{ display_name: string }[]>`
      update people set hidden_from_rep_views = ${hidden} where id = ${personId} returning display_name`;
    if (p) await audit(sql, dealer, hidden ? "person.hidden" : "person.shown", "person", personId, { name: p.display_name });
  });
  revalidatePath(`/d/${dealer.slug}`, "layout");
}

/**
 * Combines records that are really the same person (e.g. two employee IDs). Everything
 * moves to the record kept: sales history, name spellings, stores. If both sold at the
 * same store on the same day, their numbers are added together. Store totals don't change.
 */
export async function combinePeople(form: FormData) {
  const dealer = await dealerFrom(form);
  const keep = Number(form.get("keep"));
  const ids = String(form.get("ids")).split(",").map(Number).filter(Boolean);
  const others = ids.filter((id) => id !== keep);
  if (!keep || !others.length) throw new Error("Pick at least two people and the name to keep.");

  await withDealer(dealer.id, async (sql) => {
    const people = await sql<{ id: number; display_name: string; employee_code: string | null; hidden_from_rep_views: boolean }[]>`
      select id, display_name, employee_code, hidden_from_rep_views from people where id = any(${ids}) and merged_into_id is null`;
    if (people.length !== ids.length) throw new Error("Someone in this list was already combined.");

    // 1. Days where both records sold at the same store: add them into one row.
    await sql`
      insert into rep_daily_mtd (dealer_id, biz_date, store_id, person_id, m, import_batch_id)
      select dealer_id, biz_date, store_id, ${keep}, jsonb_strip_nulls(${sql.unsafe(combineExpr(STORED_KPIS.map((k) => k.code), "m"))}), max(import_batch_id)
        from rep_daily_mtd r
       where person_id = any(${ids})
         and exists (select 1 from rep_daily_mtd o where o.person_id = any(${ids}) and o.person_id <> r.person_id
                      and o.biz_date = r.biz_date and o.store_id = r.store_id)
       group by dealer_id, biz_date, store_id
      on conflict (dealer_id, biz_date, store_id, person_id) do update set m = excluded.m`;
    await sql`
      delete from rep_daily_mtd r where person_id = any(${others})
         and exists (select 1 from rep_daily_mtd k where k.person_id = ${keep} and k.biz_date = r.biz_date and k.store_id = r.store_id)`;
    // 2. Everything else just moves over.
    await sql`update rep_daily_mtd set person_id = ${keep} where person_id = any(${others})`;
    await sql`update person_aliases set person_id = ${keep} where person_id = any(${others})`;
    await sql`delete from store_assignments a where person_id = any(${others})
                and exists (select 1 from store_assignments k where k.person_id = ${keep} and k.store_id = a.store_id)`;
    await sql`update store_assignments set person_id = ${keep} where person_id = any(${others})`;
    await sql`update users set person_id = ${keep} where person_id = any(${others})`;
    // Hidden if any of the records was hidden (never show someone who was meant to be hidden).
    const hidden = people.some((p) => p.hidden_from_rep_views);
    await sql`update people set hidden_from_rep_views = ${hidden} where id = ${keep}`;
    await sql`update people set merged_into_id = ${keep}, active = false where id = any(${others})`;
    await audit(sql, dealer, "person.combined", "person", keep, {
      kept: people.find((p) => p.id === keep), combined: people.filter((p) => p.id !== keep),
    });
  });
  revalidatePath(`/d/${dealer.slug}`, "layout");
  redirect(`/d/${dealer.slug}/settings/people?q=${encodeURIComponent("")}&done=combined`);
}

// ---------------------------------------------------------------------------
// Goals and targets
// ---------------------------------------------------------------------------

/** Saves the goal inputs on one page of the goals grid ("g:<unitId>:<kpi>" fields). Blank removes a goal. */
export async function saveGoals(form: FormData) {
  const dealer = await dealerFrom(form);
  const month = String(form.get("month"));
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new Error("Invalid month");
  const changes: { unit: number; kpi: string; target: number | null }[] = [];
  for (const [key, raw] of form.entries()) {
    const m = key.match(/^g:(\d+):([a-z0-9_]+)$/);
    if (!m || !KPI_BY_CODE[m[2]]) continue;
    const before = form.get(`was:${m[1]}:${m[2]}`);
    const value = String(raw).replace(/[$,%\s]/g, "");
    if (value === String(before ?? "")) continue;
    const n = value === "" ? null : Number(value);
    if (n !== null && (!Number.isFinite(n) || n < 0)) continue;
    changes.push({ unit: Number(m[1]), kpi: m[2], target: n });
  }
  await saveTargets(dealer, month, changes, "goals.changed");
  revalidatePath(`/d/${dealer.slug}`, "layout");
}

/** Company-wide rate targets, typed as percents ("75" = 75%). */
export async function saveRateTargets(form: FormData) {
  const dealer = await dealerFrom(form);
  const month = String(form.get("month"));
  const rootId = Number(form.get("rootId"));
  const changes: { unit: number; kpi: string; target: number | null }[] = [];
  for (const [key, raw] of form.entries()) {
    const m = key.match(/^t:([a-z0-9_]+)$/);
    if (!m || !KPI_BY_CODE[m[1]]) continue;
    const value = String(raw).replace(/[%\s]/g, "");
    if (value === String(form.get(`was:${m[1]}`) ?? "")) continue;
    const pct = KPI_BY_CODE[m[1]].unit === "percent";
    const n = value === "" ? null : Number(value) / (pct ? 100 : 1);
    if (n !== null && (!Number.isFinite(n) || n < 0)) continue;
    changes.push({ unit: rootId, kpi: m[1], target: n });
  }
  await saveTargets(dealer, month, changes, "targets.changed");
  revalidatePath(`/d/${dealer.slug}`, "layout");
}

async function saveTargets(actor: Actor, month: string, changes: { unit: number; kpi: string; target: number | null }[], action: string) {
  if (!changes.length) return;
  const dealerId = actor.id;
  await withDealer(dealerId, async (sql) => {
    for (const c of changes) {
      if (c.target === null) {
        await sql`delete from kpi_goals where org_unit_id = ${c.unit} and month = ${month} and kpi_code = ${c.kpi} and goal_set = 'dealer'`;
      } else {
        await sql`
          insert into kpi_goals (dealer_id, org_unit_id, month, kpi_code, target, source, goal_set)
          values (${dealerId}, ${c.unit}, ${month}, ${c.kpi}, ${c.target}, 'manual', 'dealer')
          on conflict (dealer_id, org_unit_id, month, kpi_code, goal_set) do update set target = excluded.target, source = 'manual'`;
      }
    }
    await audit(sql, actor, action, "kpi_goals", month, { month, changes: changes.slice(0, 200), count: changes.length });
  });
}

/** Copies every goal and target from one month to another (only where the new month has none). */
export async function copyGoals(form: FormData) {
  const dealer = await dealerFrom(form);
  const from = String(form.get("from"));
  const to = String(form.get("to"));
  await withDealer(dealer.id, async (sql) => {
    const r = await sql`
      insert into kpi_goals (dealer_id, org_unit_id, month, kpi_code, target, source, goal_set)
      select dealer_id, org_unit_id, ${to}::date, kpi_code, target, 'manual', goal_set from kpi_goals
       where month = ${from} and goal_set = 'dealer'
      on conflict do nothing`;
    await audit(sql, dealer, "goals.copied", "kpi_goals", to, { from, to, count: r.count });
  });
  revalidatePath(`/d/${dealer.slug}`, "layout");
}

// ---------------------------------------------------------------------------
// Company: name, colors, logo, level names
// ---------------------------------------------------------------------------

export async function saveCompany(form: FormData) {
  const dealer = await dealerFrom(form);
  const current = (await requireAccess(dealer.slug, { admin: true })).dealer;
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const color = (v: FormDataEntryValue | null, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fallback);
  const logo = String(form.get("logo_url") ?? "").trim();
  if (logo && !/^https:\/\//.test(logo)) throw new Error("The logo address must start with https://");
  await withDealer(dealer.id, async (sql) => {
    const before = await sql`select name, primary_color, accent_color, logo_url from dealers where id = ${dealer.id}`;
    await sql`update dealers set name = ${name || dealer.name}, primary_color = ${color(form.get("primary_color"), current.primary_color)},
                     accent_color = ${color(form.get("accent_color"), current.accent_color)}, logo_url = ${logo || null}
               where id = ${dealer.id}`;
    for (const level of ["dealer", "region", "area", "district", "store"]) {
      const label = String(form.get(`label:${level}`) ?? "").trim().slice(0, 40);
      if (label) await sql`update dealer_org_levels set label = ${label} where level_key = ${level}`;
    }
    await sql`update org_units set name = ${name || dealer.name} where level_key = 'dealer'`;
    await audit(sql, dealer, "company.changed", "dealer", dealer.id, { before: before[0], after: { name, logo_url: logo || null } });
  });
  revalidatePath(`/`, "layout");
}
