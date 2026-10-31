import { KPI_BY_CODE } from "./catalog";

export type KpiMap = Record<string, number | string | null | undefined>;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));

/** Reads a KPI from a stored map, rebuilding ratio KPIs from their two counts. */
export function kpiValue(m: KpiMap | null | undefined, code: string): number | undefined {
  if (!m) return undefined;
  const kpi = KPI_BY_CODE[code];
  if (kpi?.agg === "ratio") {
    const n = num(m[kpi.numerator!]) ?? 0;
    const d = num(m[kpi.denominator!]) ?? 0;
    return d > 0 ? n / d : undefined;
  }
  // Counts that are missing from a map simply had no activity.
  return num(m[code]) ?? (kpi?.agg === "sum" ? 0 : undefined);
}

export function formatKpi(code: string, v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "–";
  const unit = KPI_BY_CODE[code]?.unit ?? "count";
  if (unit === "percent") return `${(v * 100).toFixed(1)}%`;
  if (unit === "currency") return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  if (unit === "decimal") return v.toFixed(2);
  return Math.round(v).toLocaleString("en-US");
}
