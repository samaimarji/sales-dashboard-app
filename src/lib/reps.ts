import type postgres from "postgres";
import { combineExpr, valueExpr } from "@/lib/kpis/sql";
import type { KpiMap } from "@/lib/kpis/value";

type Sql = postgres.TransactionSql;

export interface RepRow { person_id: number; display_name: string; stores: string; m: KpiMap; total: number; rank: number }

/**
 * Reps under an org unit for one date, each combined across their stores (one row per
 * person). People hidden from rep views are never returned. Sorted and paged in SQL.
 */
export async function repsUnder(sql: Sql, opts: {
  path: string; date: string; kpis: string[]; sort: string; dir?: "asc" | "desc"; limit: number; offset: number;
  search?: string; minChances?: { code: string; min: number };
  /** custom sort built from catalog codes (e.g. missedExpr), instead of a single KPI */
  orderExpr?: (col: string) => string;
}): Promise<RepRow[]> {
  const order = opts.orderExpr ? opts.orderExpr("x.m") : valueExpr(opts.sort, "x.m");
  const dir = opts.dir === "asc" ? "asc" : "desc";
  const search = opts.search ? sql`and lower(p.display_name) like ${"%" + opts.search.toLowerCase() + "%"}` : sql``;
  const min = opts.minChances ? sql`where ${sql.unsafe(valueExpr(opts.minChances.code, "x.m"))} >= ${opts.minChances.min}` : sql``;
  return sql<RepRow[]>`
    with x as (
      select p.id as person_id, p.display_name,
             string_agg(distinct st.code, ' + ' order by st.code) as stores,
             ${sql.unsafe(combineExpr([...opts.kpis, opts.sort, ...(opts.minChances ? [opts.minChances.code] : [])], "r.m"))} as m
        from rep_daily_mtd r
        join people p on p.id = r.person_id and not p.hidden_from_rep_views
        join org_units st on st.id = r.store_id
       where r.biz_date = ${opts.date} and st.path <@ ${opts.path}::ltree ${search}
       group by p.id, p.display_name
    )
    select x.*, count(*) over ()::int as total,
           rank() over (order by ${sql.unsafe(order)} ${sql.unsafe(dir)} nulls last)::int as rank
      from x ${min}
     order by ${sql.unsafe(order)} ${sql.unsafe(dir)} nulls last, x.display_name
     limit ${opts.limit} offset ${opts.offset}`;
}
