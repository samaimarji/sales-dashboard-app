/**
 * Importer tests. Uses the generated sample exports, so run first:
 *   npm run samples -- --dealer sunrise --date 2026-10-30
 *   npm run samples -- --dealer pacific-coast --date 2026-10-30 --break
 * then: npm test
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mergeDay } from "@/lib/imports/merge";
import { parseFile, parseGrid, splitRep, storeNumberOf, toNumber } from "@/lib/imports/parse";
import { reconcile } from "@/lib/imports/reconcile";

async function load(dir: string) {
  return Promise.all(readdirSync(dir).map((f) => parseFile(f, readFileSync(join(dir, f)))));
}

test("reads numbers the way Power BI writes them", () => {
  assert.equal(toNumber("1,234.50"), 1234.5);
  assert.equal(toNumber("$12.00"), 12);
  assert.equal(toNumber("45%"), 0.45);
  assert.equal(toNumber(""), null);
  assert.equal(toNumber(null), null);
  assert.equal(storeNumberOf("228: Some Dealer - Main St"), "228");
  assert.equal(storeNumberOf("Total"), null);
  assert.deepEqual(splitRep("JANE DOE-SMITH - jd1234"), { name: "Jane Doe-Smith", code: "jd1234" });
});

test("MTD report: two header rows, store totals and goals by group", () => {
  // Same layout as the real report (made-up numbers); "Access" is column M.
  const grid = [
    [null, null, null, null, null, "Month To Date Performance Report"],
    [],
    [null, "Activations", null, null, "Upgrades", null, null, "Upgrade Plus Opportunities", null, null, "Accessories", null, null, null],
    ["Location Code", "Goal ", "Activations", "%", "Goals", "Upgrades", "%", "Upgrade Plus Opportunities", "Upgrade Plus Adds",
      "Upgrade Plus Attach Rate", "Goals", "PPP Accessories Sales", "Access", "%"],
    ["101: Demo Dealer - Main St", 80, 75, 0.94, 30, 16, 0.53, 90, 40, 0.44, 7000, null, 6500.25, 0.93],
    ["Total", 80, 75, null, 30, 16, null, 90, 40, null, 7000, null, 6500.25, null],
  ];
  const f = parseGrid("x.xlsx", grid);
  assert.equal(f.type, "mtd");
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.records[0].values, { activations: 75, upgrades: 16, upgrade_plus_opps: 90, upgrade_plus_adds: 40, accessory_revenue: 6500.25 });
  const goals = Object.fromEntries(f.goals.map((g) => [g.kpi, g.target]));
  assert.deepEqual(goals, { activations: 80, upgrades: 30, accessory_revenue: 7000 });
});

const sunrise = "samples/sunrise-2026-10-30";
test("clean files: all 7 recognized by header, every check passes", { skip: !existsSync(sunrise) }, async () => {
  const files = await load(sunrise);
  assert.deepEqual(files.map((f) => f.type).sort(), ["chi", "features", "fees", "matrix", "mtd", "rank", "retention"]);
  const r = reconcile(files, null);
  assert.equal(r.dateThrough, "2026-10-30");
  assert.deepEqual(r.issues.filter((i) => i.severity === "error"), []);
  assert.ok(r.checks.every((c) => c.status === "pass"));

  // Store totals in the merged day equal the MTD file, and include everyone (hidden or not).
  const merged = mergeDay(files);
  const mtd = files.find((f) => f.type === "mtd")!;
  for (const rec of mtd.records) assert.equal(merged.storeRows.get(rec.storeNumber)!.activations, rec.values.activations);
});

const broken = "samples/pacific-coast-2026-10-30-broken";
test("1,000-store files with 3 planted mistakes: exactly those are flagged", { skip: !existsSync(broken) }, async () => {
  const files = await load(broken);
  const r = reconcile(files, "2026-10-29");
  const errors = r.issues.filter((i) => i.severity === "error");
  // Nothing else is flagged: only the three stores that were tampered with.
  assert.deepEqual([...new Set(errors.map((e) => e.storeNumber))].sort(), ["1001", "1002", "1003"]);
  assert.ok(errors.some((e) => e.check === "matrix_vs_mtd" && e.storeNumber === "1001"));
  assert.ok(errors.some((e) => e.check === "rank_vs_mtd" && e.storeNumber === "1002"));
  assert.ok(errors.some((e) => e.check === "features_vs_mtd" && e.storeNumber === "1003"));
  assert.ok(r.issues.some((i) => i.check === "date" && i.severity === "info"), "file date wins over the chosen date");
});
