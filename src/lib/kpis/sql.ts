import { KPI_BY_CODE } from "./catalog";

/**
 * SQL snippets built from the KPI catalog, so sorting and adding up reps happens in
 * the database (never by loading thousands of rows into the app). Only catalog codes
 * are ever placed into SQL text.
 */

const safe = (code: string) => {
  if (!KPI_BY_CODE[code] || !/^[a-z0-9_]+$/.test(code)) throw new Error(`Unknown KPI ${code}`);
  return code;
};

/** Stored KPIs needed to calculate `codes` (ratio parts, weights, added parts). */
export function storedInputs(codes: string[]): string[] {
  const out = new Set<string>();
  const visit = (c: string) => {
    const k = KPI_BY_CODE[c];
    if (!k) return;
    if (k.parts) k.parts.forEach(visit);
    else if (k.agg === "ratio") { visit(k.numerator!); visit(k.denominator!); }
    else {
      out.add(c);
      if (k.weightKpi) out.add(k.weightKpi);
    }
  };
  codes.forEach(visit);
  return [...out];
}

/** Expression for a KPI's value from a jsonb map column (for ORDER BY). */
export function valueExpr(code: string, col = "m"): string {
  const k = KPI_BY_CODE[safe(code)];
  if (k.parts) return `(${k.parts.map((p) => `coalesce(${valueExpr(p, col)}, 0)`).join(" + ")})`;
  if (k.agg === "ratio") {
    return `(coalesce(${valueExpr(k.numerator!, col)}, 0) / nullif(${valueExpr(k.denominator!, col)}, 0) * ${k.scale ?? 1})`;
  }
  return `(${col} ->> '${code}')::numeric`;
}

/**
 * jsonb_build_object(...) that adds up rows of jsonb maps (e.g. one rep at two stores,
 * or every rep in a district): counts summed, file-only percentages weighted.
 */
export function combineExpr(codes: string[], col = "m"): string {
  const parts = storedInputs(codes).map((c) => {
    const k = KPI_BY_CODE[safe(c)];
    if (k.agg === "weighted_avg") {
      const w = `coalesce((${col} ->> '${safe(k.weightKpi!)}')::numeric, 0)`;
      return `'${c}', sum((${col} ->> '${c}')::numeric * ${w}) / nullif(sum(case when ${col} ? '${c}' then ${w} end), 0)`;
    }
    return `'${c}', sum(coalesce((${col} ->> '${c}')::numeric, 0))`;
  });
  // jsonb_build_object takes at most 100 arguments; chain with || for more.
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += 45) chunks.push(`jsonb_build_object(${parts.slice(i, i + 45).join(", ")})`);
  return chunks.length ? chunks.join(" || ") : "'{}'::jsonb";
}

/** Total missed chances (chances - sold, never below 0) across the opportunity products. */
export function missedExpr(items: readonly { chances: string; sold: string }[], col = "m"): string {
  return `(${items.map((o) => `greatest(0, coalesce(${valueExpr(o.chances, col)}, 0) - coalesce(${valueExpr(o.sold, col)}, 0))`).join(" + ")})`;
}
