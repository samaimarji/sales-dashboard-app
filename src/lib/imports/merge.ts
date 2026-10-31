import { KPI_BY_CODE, type FileType } from "@/lib/kpis/catalog";
import type { ParsedFile, ParsedGoal } from "./parse";

export type Kpis = Record<string, number>;

export interface RepRow {
  storeNumber: string;
  repRaw: string;
  repName: string;
  repCode: string | null;
  m: Kpis;
}

export interface MergedDay {
  repRows: RepRow[];
  /** store number -> KPIs (rep files added up, then the store files on top) */
  storeRows: Map<string, Kpis>;
  storeLocations: Map<string, string>;
  goals: ParsedGoal[];
}

// When two files carry the same KPI, the first file in this order wins.
const REP_PRIORITY: FileType[] = ["matrix", "features", "fees", "retention", "chi"];
const STORE_PRIORITY: FileType[] = ["mtd", "rank"];

/**
 * Adds KPI maps together using each KPI's rule: counts and dollars are summed,
 * file-only percentages are weighted by their size KPI. Ratio KPIs aren't stored.
 */
export function combine(maps: Kpis[]): Kpis {
  if (maps.length === 1) return { ...maps[0] };
  const out: Kpis = {};
  const wsum: Record<string, number> = {};
  const wtot: Record<string, number> = {};
  const plain: Record<string, number[]> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      const kpi = KPI_BY_CODE[k];
      if (kpi?.agg === "weighted_avg") {
        const w = m[kpi.weightKpi!] ?? 0;
        wsum[k] = (wsum[k] ?? 0) + v * w;
        wtot[k] = (wtot[k] ?? 0) + w;
        (plain[k] ??= []).push(v);
      } else {
        out[k] = (out[k] ?? 0) + v;
      }
    }
  }
  for (const k of Object.keys(plain)) {
    out[k] = wtot[k] > 0 ? wsum[k] / wtot[k] : plain[k].reduce((a, b) => a + b, 0) / plain[k].length;
    out[k] = Math.round(out[k] * 10000) / 10000;
  }
  for (const [k, v] of Object.entries(out)) {
    if (KPI_BY_CODE[k]?.unit === "currency") out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

export function mergeDay(files: ParsedFile[]): MergedDay {
  const byType = new Map(files.filter((f) => f.type).map((f) => [f.type!, f]));

  const reps = new Map<string, RepRow>();
  for (const t of REP_PRIORITY) {
    for (const r of byType.get(t)?.records ?? []) {
      const key = `${r.storeNumber}|${r.repCode ?? r.repRaw}`;
      let row = reps.get(key);
      if (!row) {
        row = { storeNumber: r.storeNumber, repRaw: r.repRaw!, repName: r.repName!, repCode: r.repCode ?? null, m: {} };
        reps.set(key, row);
      }
      for (const [k, v] of Object.entries(r.values)) if (!(k in row.m)) row.m[k] = v;
    }
  }
  const repRows = [...reps.values()];

  const storeLocations = new Map<string, string>();
  const repsByStore = new Map<string, Kpis[]>();
  for (const r of repRows) (repsByStore.get(r.storeNumber) ?? repsByStore.set(r.storeNumber, []).get(r.storeNumber)!).push(r.m);
  for (const t of [...REP_PRIORITY, ...STORE_PRIORITY]) {
    for (const r of byType.get(t)?.records ?? []) if (!storeLocations.has(r.storeNumber) || t === "mtd") storeLocations.set(r.storeNumber, r.location);
  }

  // Store numbers: start from the reps added up, then the store files replace what they report.
  const storeRows = new Map<string, Kpis>();
  for (const [store, maps] of repsByStore) storeRows.set(store, combine(maps));
  for (const t of [...STORE_PRIORITY].reverse()) {
    for (const r of byType.get(t)?.records ?? []) {
      storeRows.set(r.storeNumber, { ...(storeRows.get(r.storeNumber) ?? {}), ...r.values });
    }
  }
  // Only stores in the store-level files count toward totals when those files are present.
  if (byType.has("mtd")) {
    const listed = new Set(byType.get("mtd")!.records.map((r) => r.storeNumber));
    for (const s of [...storeRows.keys()]) if (!listed.has(s)) storeRows.delete(s);
  }

  const goals = [...(byType.get("mtd")?.goals ?? []), ...(byType.get("rank")?.goals ?? [])];
  return { repRows, storeRows, storeLocations, goals };
}
