import { KPI_BY_CODE, type FileType } from "@/lib/kpis/catalog";
import { FILE_TYPES, FILE_TYPE_BY_KEY } from "./file-types";
import type { ParsedFile, ParsedRecord } from "./parse";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  check: string;
  storeNumber?: string;
  kpi?: string;
  expected?: number;
  actual?: number;
  message: string;
}

export interface CheckResult {
  key: string;
  label: string;
  status: "pass" | "fail" | "skipped";
  compared: number;
  mismatches: number;
  note?: string;
}

/**
 * Store-vs-store comparisons. Each one: sum `from` file's rows per store and compare
 * with the `against` file, for the listed KPIs.
 */
const CHECKS: { key: string; label: string; from: FileType; against: FileType; kpis: string[] }[] = [
  { key: "matrix_vs_mtd", label: "Rep totals match store totals (Detailed Matrix vs MTD)", from: "matrix", against: "mtd",
    kpis: ["activations", "upgrades", "accessory_revenue"] },
  { key: "rank_vs_mtd", label: "Rank export matches MTD", from: "rank", against: "mtd", kpis: ["activations", "upgrades"] },
  { key: "chi_vs_mtd", label: "CHI file matches MTD", from: "chi", against: "mtd", kpis: ["chi_orders", "chi_addresses_checked"] },
  { key: "features_vs_mtd", label: "Features file matches MTD", from: "features", against: "mtd",
    kpis: ["upgrade_plus_opps", "upgrade_plus_adds"] },
];

const tolerance = (kpi: string) => (KPI_BY_CODE[kpi]?.unit === "currency" ? 0.05 : 0.5);

function sumByStore(records: ParsedRecord[], kpis: string[]) {
  const out = new Map<string, Record<string, number>>();
  for (const r of records) {
    const t = out.get(r.storeNumber) ?? Object.fromEntries(kpis.map((k) => [k, 0]));
    for (const k of kpis) t[k] += r.values[k] ?? 0;
    out.set(r.storeNumber, t);
  }
  return out;
}

const fmt = (kpi: string, v: number) =>
  KPI_BY_CODE[kpi]?.unit === "currency"
    ? v.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : (Math.round(v * 100) / 100).toLocaleString("en-US");

export interface ReconcileResult {
  dateThrough: string | null;
  dateSource: "file" | "chosen";
  checks: CheckResult[];
  issues: Issue[];
}

export function reconcile(files: ParsedFile[], chosenDate: string | null): ReconcileResult {
  const issues: Issue[] = [];
  const byType = new Map<FileType, ParsedFile>();

  // --- files: recognized, no duplicates, the MTD file present ---
  for (const f of files) {
    if (!f.type) {
      issues.push({ severity: "error", check: "files", message: `${f.name}: ${f.error ?? "not recognized"}` });
      continue;
    }
    if (byType.has(f.type)) {
      issues.push({ severity: "error", check: "files",
        message: `Two ${f.label} files uploaded (${byType.get(f.type)!.name} and ${f.name}). Remove one.` });
      continue;
    }
    byType.set(f.type, f);
    if (!f.records.length) issues.push({ severity: "error", check: "files", message: `${f.name} (${f.label}) has no store or rep rows.` });
    if (f.ignoredColumns.length) {
      issues.push({ severity: "info", check: "files", message: `${f.label}: new columns not used yet: ${f.ignoredColumns.join(", ")}` });
    }
  }
  if (!byType.has("mtd")) {
    issues.push({ severity: "error", check: "files", message: "The MTD Performance file is required. Store totals come from it." });
  }
  for (const def of FILE_TYPES) {
    if (def.type !== "mtd" && !byType.has(def.type)) {
      issues.push({ severity: "warning", check: "files",
        message: `${def.label} file not included. Its numbers will be empty for this day.` });
    }
  }

  // --- one date for all files ---
  const dates = [...new Set([...byType.values()].map((f) => f.dateThrough).filter((d): d is string => !!d))];
  let dateThrough: string | null = chosenDate;
  let dateSource: "file" | "chosen" = "chosen";
  if (dates.length > 1) {
    const detail = [...byType.values()].filter((f) => f.dateThrough).map((f) => `${f.label}: ${f.dateThrough}`).join(", ");
    issues.push({ severity: "error", check: "date", message: `Files cover different dates (${detail}). Download them all again for the same day.` });
  } else if (dates.length === 1) {
    dateThrough = dates[0];
    dateSource = "file";
    if (chosenDate && chosenDate !== dates[0]) {
      issues.push({ severity: "info", check: "date", message: `The files say numbers are through ${dates[0]}, so that date is used instead of ${chosenDate}.` });
    }
  }
  if (!dateThrough) issues.push({ severity: "error", check: "date", message: "No date found in the files. Pick the date on the upload page." });

  // --- store-level comparisons ---
  const checks: CheckResult[] = [];
  const mtd = byType.get("mtd");
  const mtdStores = new Map(mtd?.records.map((r) => [r.storeNumber, r]) ?? []);
  for (const c of CHECKS) {
    const from = byType.get(c.from);
    if (!from || !mtd) {
      checks.push({ key: c.key, label: c.label, status: "skipped", compared: 0, mismatches: 0, note: "File not included" });
      continue;
    }
    const sums = sumByStore(from.records, c.kpis);
    let mismatches = 0;
    let compared = 0;
    for (const [store, target] of mtdStores) {
      const got = sums.get(store);
      compared++;
      for (const k of c.kpis) {
        const expected = target.values[k] ?? 0;
        const actual = got?.[k] ?? 0;
        if (Math.abs(expected - actual) > tolerance(k)) {
          mismatches++;
          issues.push({
            severity: "error", check: c.key, storeNumber: store, kpi: k, expected, actual,
            message: `Store ${store} ${KPI_BY_CODE[k]?.label ?? k}: MTD says ${fmt(k, expected)}, ${from.label.replace(/ \(.*\)$/, "")} ${FILE_TYPE_BY_KEY[c.from].level === "rep" ? "reps add up to" : "says"} ${fmt(k, actual)}.`,
          });
        }
      }
    }
    for (const store of sums.keys()) {
      if (!mtdStores.has(store)) {
        issues.push({ severity: "warning", check: c.key, storeNumber: store,
          message: `Store ${store} is in the ${from.label} file but not in MTD. Its rep numbers are saved but it isn't checked.` });
      }
    }
    checks.push({ key: c.key, label: c.label, status: mismatches ? "fail" : "pass", compared, mismatches });
  }

  return { dateThrough, dateSource, checks, issues };
}
