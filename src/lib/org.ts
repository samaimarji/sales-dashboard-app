import type postgres from "postgres";
import { monthProgress, type MonthProgress } from "@/lib/kpis/pace";

type Sql = postgres.TransactionSql;

export interface Unit { id: number; name: string; level_key: string; code: string | null; path: string; parent_id: number | null }

export interface OrgContext {
  labels: Record<string, string>;
  /** enabled levels below the company, top to bottom (e.g. region, district, store) */
  levels: string[];
  current: Unit;
  crumbs: Unit[];
  latest: Date;
  latestIso: string;
  mp: MonthProgress;
}

/**
 * Where we are in the org tree, plus the latest date with numbers. With `roots` (the
 * user's allowed part of the tree), a unit outside it falls back to the user's own top
 * unit, and breadcrumbs stop at what they may see.
 */
export async function orgContext(sql: Sql, unitId?: number | string | null, roots?: string[]): Promise<OrgContext | null> {
  const levelRows = await sql<{ level_key: string; label: string; enabled: boolean }[]>`
    select level_key, label, enabled from dealer_org_levels order by depth`;
  const labels = Object.fromEntries(levelRows.map((l) => [l.level_key, l.label]));
  const levels = levelRows.filter((l) => l.enabled && l.level_key !== "dealer").map((l) => l.level_key);
  const id = Number(unitId);
  let [current] = id
    ? await sql<Unit[]>`select id, name, level_key, code, path::text, parent_id from org_units where id = ${id}`
    : await sql<Unit[]>`select id, name, level_key, code, path::text, parent_id from org_units where level_key = 'dealer'`;
  const allowed = (path: string) => !roots || roots.some((r) => path === r || path.startsWith(r + "."));
  if (roots && (!current || !allowed(current.path))) {
    if (!roots.length) return null;
    [current] = await sql<Unit[]>`select id, name, level_key, code, path::text, parent_id from org_units where path = ${roots[0]}::ltree`;
  }
  if (!current) return null;
  const crumbs = (await sql<Unit[]>`
    select id, name, level_key, code, path::text, parent_id from org_units where path @> ${current.path}::ltree order by nlevel(path)`)
    .filter((c) => allowed(c.path));
  const [{ d }] = await sql<{ d: Date | null }[]>`select max(biz_date) as d from org_rollup_daily`;
  const latest = d ?? new Date();
  return { labels, levels, current, crumbs, latest, latestIso: latest.toISOString().slice(0, 10), mp: monthProgress(latest) };
}

export const fmtDate = (d: Date | string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(d).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

/** Name to show for a store: "1852 · Bellmont - Pacific Ave". */
export const unitName = (u: { level_key: string; code: string | null; name: string }) =>
  u.level_key === "store" && u.code ? `${u.code} · ${u.name}` : u.name;

/** "Territory" -> "Territories", "District" -> "Districts". */
export const plural = (word: string) =>
  /[^aeiou]y$/i.test(word) ? word.slice(0, -1) + "ies" : /(s|x|ch|sh)$/i.test(word) ? word + "es" : word + "s";
