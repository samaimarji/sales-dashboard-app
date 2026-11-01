import type postgres from "postgres";
import { KPI_BY_CODE } from "./catalog";

type Sql = postgres.TransactionSql;
export type GoalMap = Map<number, Record<string, number>>;

/**
 * Monthly goals for org units:
 *  - counts and dollars: the store goals under the unit, added up
 *  - rates: the closest goal set at the unit or above (usually one company-wide target)
 */
export async function goalsFor(sql: Sql, unitIds: number[], month: string): Promise<GoalMap> {
  const out: GoalMap = new Map(unitIds.map((id) => [id, {}]));
  if (!unitIds.length) return out;
  const sums = await sql<{ unit_id: number; kpi_code: string; target: string }[]>`
    select u.id as unit_id, g.kpi_code, sum(g.target) as target
      from org_units u
      join org_units st on st.path <@ u.path and st.level_key = 'store'
      join kpi_goals g on g.org_unit_id = st.id and g.month = ${month} and g.goal_set = 'dealer'
     where u.id = any(${unitIds})
     group by u.id, g.kpi_code`;
  for (const r of sums) if (KPI_BY_CODE[r.kpi_code]?.agg === "sum") out.get(r.unit_id)![r.kpi_code] = Number(r.target);
  const rates = await sql<{ unit_id: number; kpi_code: string; target: string }[]>`
    select distinct on (u.id, g.kpi_code) u.id as unit_id, g.kpi_code, g.target
      from org_units u
      join org_units a on a.path @> u.path
      join kpi_goals g on g.org_unit_id = a.id and g.month = ${month} and g.goal_set = 'dealer'
     where u.id = any(${unitIds})
     order by u.id, g.kpi_code, nlevel(a.path) desc`;
  for (const r of rates) if (KPI_BY_CODE[r.kpi_code]?.agg !== "sum") out.get(r.unit_id)![r.kpi_code] = Number(r.target);
  return out;
}

/**
 * A rep's goals: each store's goal split evenly among the people who sold there this
 * month, added up across their stores. Rate targets come from the store.
 */
export async function repGoals(sql: Sql, personId: number, date: string, month: string): Promise<Record<string, number>> {
  const rows = await sql<{ store_id: number; reps: number }[]>`
    select r.store_id, (select count(*)::int from rep_daily_mtd x where x.store_id = r.store_id and x.biz_date = r.biz_date) as reps
      from rep_daily_mtd r where r.person_id = ${personId} and r.biz_date = ${date}`;
  const goals = await goalsFor(sql, rows.map((r) => r.store_id), month);
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(goals.get(r.store_id) ?? {})) {
      if (KPI_BY_CODE[k]?.agg === "sum") out[k] = (out[k] ?? 0) + v / Math.max(1, r.reps);
      else out[k] ??= v;
    }
  }
  return out;
}
