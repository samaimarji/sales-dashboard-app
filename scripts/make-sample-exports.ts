/**
 * Writes the 7 daily Power BI exports for a demo dealer and date, laid out like the
 * real files (same headers, title rows, "Total" row and "Applied filters" note), using
 * the made-up sample data. Used to demo and test the daily upload.
 *
 *   npm run samples -- --dealer sunrise --date 2026-10-30
 *   npm run samples -- --dealer pacific-coast --date 2026-10-30 --break   (adds 3 mismatches)
 *
 * Files go to samples/<dealer>-<date>[-broken]/.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { KPI_CATALOG, type FileType } from "../src/lib/kpis/catalog";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = arg("dealer") ?? "sunrise";
const date = arg("date") ?? "2026-10-30";
const broken = args.includes("--break");

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
const sql = postgres(url, { max: 2, onnotice: () => {} });

// Header rows exactly as the Power BI exports have them.
const HEADERS: Record<Exclude<FileType, "mtd">, string[]> = {
  rank: ["Location", "Sales Code", "Region", "Market", "Submarket", "Total Connected Gross Adds", "TCGA Perf Target", "TCGA Attain",
    "Wireless Gross Adds", "Wireless Gross Adds Perf Target", "Wireless Gross Adds Attain", "Home Internet Orders", "Home Internet Gross Adds",
    "Device Upgrades", "Net Disconnects", "Net Adds", "BYOD Activation %", "Add-a-Line Activations %", "Multiline Activations %",
    "$35 Sensible Activations", "$40 Select Activations", "$50 Smart Activations", "$55 Legacy Unlimited Activations",
    "$60 Legacy Unlimited Activations", "$60 Supreme Activations", "$60+ Rate Plan Mix", "Simply Data Activations", "Watch Activations",
    "Max Activation Attach Rate", "BOP Subscribers", "EOP Subscribers", "Churn Rate", "Retention Rate (CCS)", "BOP Open Stores"],
  matrix: ["Location", "Sales Code", "Advocate Name and ID", "Total Connected Gross Adds", "Wireless Gross Adds", "Home Internet Orders",
    "Home Internet Gross Adds", "Device Upgrades", "BYOD Activation %", "Add-a-Line Activations %", "Multiline Activations %",
    "$35 Sensible Activations", "$40 Select Activations", "$50 Smart Activations", "$55 Legacy Unlimited Activations",
    "$60 Legacy Unlimited Activations", "$60 Supreme Activations", "$60+ Rate Plan Mix", "Simply Data Activations", "Watch Activations",
    "Max Activation Attach Rate", "Autopay Enrollment Rate", "Protect Attach Rate (All-In)", "ILD Opportunities", "ILD Adds",
    "ILD Attach Rate", "Upgrade Plus Opportunities", "Upgrade Plus Adds", "Upgrade Plus Attach Rate", "Accessory Revenue",
    "Accessory Revenue per Opportunity", "Total PPP Application Links Sent", "Bread Leases Funded", "Progressive Leases Funded",
    "Total PPP Attach Rate", "WTR", "Port In", "Port Out", "Port Ratio", "Bill Payment", "Full Customer Assistance Fees",
    "Plan Upgrades within 30 days of Activation Date", "Plan Downgrades within 30 days of Activation Date", "Free Shipping Gross Adds",
    "Free Shipping Upgrades"],
  fees: ["Location", "Sales Code", "Advocate Name and ID", "Activation Fees", "Discounted Activation Fees", "Discounted Activation Fee Attach Rate",
    "Discounted Activation Fee Revenue", "Waived Activation Fees", "Waived Activation Fee Attach Rate", "Waived Activation Fee Revenue",
    "Average Activation Fees Collected", "Upgrade Fees", "Discounted Upgrade Fees", "Discounted Upgrade Fee Attach Rate",
    "Discounted Upgrade Fee Revenue", "Waived Upgrade Fees", "Waived Upgrade Fee Attach Rate", "Waived Upgrade Fee Revenue", "Bill Payment"],
  retention: ["Authorized Retailer", "Location", "Advocate Name and ID", "BOP Subscribers", "EOP Subscribers", "Net Disconnects", "Net Adds",
    "Voluntary Churn", "Involuntary Churn", "Churn Monthly", "EOP Suspended", "Autopay Enrollments", "Autopay Opportunities",
    "Autopay Enrollment Rate", "Multiline Activations %", "Port In Gross Add %"],
  chi: ["Location", "Sales Code", "Advocate Name and ID", "Addresses Checked", "Addresses Checked / Door", "Addresses Eligible",
    "Addresses Credit Checked", "Credit Checks % of Address Checks", "Advanced Payment Required", "Total Orders", "Orders / Door",
    "% of Addresses Checked with Internet Order", "Close Rate", "Gross Adds"],
  features: ["Location", "Sales Code", "Advocate Name and ID", "Autopay Opportunities", "Autopay Enrollments", "Autopay Rate",
    "Protect Opportunities", "Protect Adds", "Protect Attach Rate (All-In)", "Upgrade Plus Opportunities", "Upgrade Plus Adds",
    "Upgrade Plus Attach Rate", "Hotspot Opportunities", "Hotspot Adds", "Hotspot Attach Rate", "ILD Opportunities", "ILD Adds", "ILD Attach Rate"],
};

// MTD report: [group, column] pairs. "Access" lands in column M, as in the real report.
const MTD: [string, string][] = [
  ["", "Location Code"],
  ["Activations", "Goal "], ["Activations", "Activations"], ["Activations", "%"],
  ["Upgrades", "Goals"], ["Upgrades", "Upgrades"], ["Upgrades", "%"],
  ["Upgrade Plus Opportunities", "Upgrade Plus Opportunities"], ["Upgrade Plus Opportunities", "Upgrade Plus Adds"], ["Upgrade Plus Opportunities", "Upgrade Plus Attach Rate"],
  ["Accessories", "Goals"], ["Accessories", "PPP Accessories Sales"], ["Accessories", "Access"], ["Accessories", "%"],
  ["PPP & Payment", "Cricket Bill Payment"], ["PPP & Payment", "PPP Applications Submitted"], ["PPP & Payment", "Progressive Lease Vendor Rebate"],
  ["Bread Financial", "Submitted"], ["Bread Financial", "Approved"],
  ["CHI", "Goals"], ["CHI", "Addresses Checked for CHI"], ["CHI", "Addresses Eligible for CHI"], ["CHI", "Achieved"],
];

type M = Record<string, number>;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const SOURCE = new Map<string, { kpi: string; role: string }>();
for (const k of KPI_CATALOG) for (const s of k.sources) SOURCE.set(`${s.file}|${norm(s.header)}`, { kpi: k.code, role: s.role ?? "value" });
const BY_CODE = Object.fromEntries(KPI_CATALOG.map((k) => [k.code, k]));

function value(m: M, kpi: string): number | null {
  const k = BY_CODE[kpi];
  if (k.agg === "ratio") {
    const d = m[k.denominator!] ?? 0;
    return d > 0 ? Math.round(((m[k.numerator!] ?? 0) / d) * 1e6) / 1e6 : null;
  }
  return m[kpi] ?? null;
}

async function main() {
  const [dealer] = await sql<{ id: number; name: string }[]>`select id, name from dealers where slug = ${slug}`;
  if (!dealer) throw new Error(`No dealer "${slug}". Run npm run db:seed first.`);
  const month = date.slice(0, 8) + "01";
  const stores = await sql<{ id: number; store_number: string; sales_code: string; name: string; address: string | null; district: string | null; area: string | null; region: string | null; m: M }[]>`
    select s.org_unit_id as id, s.store_number, s.sales_code, u.name, s.address,
           (select a.name from org_units a where a.path @> u.path and a.level_key = 'district') as district,
           (select a.name from org_units a where a.path @> u.path and a.level_key = 'area') as area,
           (select a.name from org_units a where a.path @> u.path and a.level_key = 'region') as region,
           d.m
      from stores s join org_units u on u.id = s.org_unit_id
      join store_daily_mtd d on d.store_id = s.org_unit_id and d.biz_date = ${date}
     where s.dealer_id = ${dealer.id} order by s.store_number::int`;
  if (!stores.length) throw new Error(`No numbers for ${slug} on ${date}.`);
  const reps = await sql<{ store_id: number; display_name: string; employee_code: string; m: M }[]>`
    select r.store_id, p.display_name, p.employee_code, r.m
      from rep_daily_mtd r join people p on p.id = r.person_id
     where r.dealer_id = ${dealer.id} and r.biz_date = ${date}
     order by r.store_id, p.display_name`;
  const goals = await sql<{ org_unit_id: number; kpi_code: string; goal_set: string; target: string }[]>`
    select org_unit_id, kpi_code, goal_set, target from kpi_goals where dealer_id = ${dealer.id} and month = ${month}`;
  const goalOf = new Map(goals.map((g) => [`${g.org_unit_id}|${g.kpi_code}|${g.goal_set}`, Number(g.target)]));
  const storeById = new Map(stores.map((s) => [s.id, s]));

  const next = new Date(date + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const filters = `Applied filters:\nCalendar Date is on or after ${month} and is before ${next.toISOString().slice(0, 10)}\nAuthorized Retailer is ${dealer.name}`;
  const shortLoc = (s: (typeof stores)[number]) => `${s.store_number}: ${dealer.name} - ${s.name.split(" - ")[1] ?? s.name}`;
  const longLoc = (s: (typeof stores)[number]) => `${s.store_number}: ${dealer.name}, ${s.address ?? s.name}`;

  const outDir = join("samples", `${slug}-${date}${broken ? "-broken" : ""}`);
  mkdirSync(outDir, { recursive: true });
  const write = async (file: string, rows: (string | number | null)[][]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Export");
    for (const r of rows) ws.addRow(r);
    await wb.xlsx.writeFile(join(outDir, file));
  };

  // --- store-level: MTD report ---
  const mtdRows: (string | number | null)[][] = [[null, null, null, null, null, "Month To Date Performance Report"], []];
  mtdRows.push(MTD.map(([g], i) => (g && (i === 0 || MTD[i - 1][0] !== g) ? g : null)));
  mtdRows.push(MTD.map(([, h]) => h));
  for (const s of stores) {
    let lastValue: number | null = null;
    let lastGoal: number | null = null;
    mtdRows.push(MTD.map(([g, h], i) => {
      if (i === 0) return shortLoc(s);
      if (h === "%") return lastGoal ? Math.round(((lastValue ?? 0) / lastGoal) * 1e6) / 1e6 : null;
      const src = SOURCE.get(`mtd|${norm(`${g} › ${h}`)}`);
      if (!src) return null;
      if (src.role === "goal") return (lastGoal = goalOf.get(`${s.id}|${src.kpi}|dealer`) ?? null);
      return (lastValue = value(s.m, src.kpi) ?? 0);
    }));
  }
  mtdRows.push([], [filters]);
  await write("MTD Performance Report.xlsx", mtdRows);

  // --- store-level: rank export ---
  const rankRows: (string | number | null)[][] = [HEADERS.rank];
  for (const s of stores) {
    rankRows.push(HEADERS.rank.map((h) => {
      switch (h) {
        case "Location": return shortLoc(s);
        case "Sales Code": return s.sales_code;
        case "Region": return s.region ?? "West";
        case "Market": return s.area ?? "Southwest";
        case "Submarket": return s.district;
        case "TCGA Attain": { const t = goalOf.get(`${s.id}|activations|cricket`); return t ? Math.round(((s.m.activations ?? 0) / t) * 1e6) / 1e6 : null; }
        case "Wireless Gross Adds Attain": { const t = goalOf.get(`${s.id}|wireless_gross_adds|cricket`); return t ? Math.round(((s.m.wireless_gross_adds ?? 0) / t) * 1e6) / 1e6 : null; }
      }
      const src = SOURCE.get(`rank|${norm(h)}`);
      if (!src) return null;
      if (src.role === "target") return goalOf.get(`${s.id}|${src.kpi}|cricket`) ?? null;
      return value(s.m, src.kpi);
    }));
  }
  rankRows.push([filters]);
  if (broken) {
    const r = rankRows[2];
    const i = HEADERS.rank.indexOf("Device Upgrades");
    r[i] = Number(r[i] ?? 0) + 1;
    console.log(`Broken: rank export store ${String(r[0]).split(":")[0]} upgrades +1`);
  }
  await write("Rank Export.xlsx", rankRows);

  // --- rep-level files ---
  for (const type of ["matrix", "fees", "retention", "chi", "features"] as const) {
    const headers = HEADERS[type];
    const rows: (string | number | null)[][] = [headers];
    const totals = headers.map(() => 0);
    for (const r of reps) {
      const s = storeById.get(r.store_id)!;
      const row = headers.map((h, i) => {
        switch (h) {
          case "Location": return longLoc(s);
          case "Authorized Retailer": return dealer.name;
          case "Sales Code": return s.sales_code;
          case "Advocate Name and ID": return `${r.display_name.toUpperCase()} - ${r.employee_code.toLowerCase()}`;
        }
        const src = SOURCE.get(`${type}|${norm(h)}`);
        const v = src ? value(r.m, src.kpi) : null;
        if (v && BY_CODE[src!.kpi].agg !== "ratio" && BY_CODE[src!.kpi].agg !== "weighted_avg") totals[i] += v;
        return v ? v : null; // Power BI leaves zeros blank
      });
      rows.push(row);
    }
    if (broken && type === "matrix") {
      const i = headers.indexOf("Accessory Revenue");
      const row = rows.find((r, n) => n > 0 && r[i]);
      if (row) { row[i] = Math.round((Number(row[i]) + 25) * 100) / 100; console.log(`Broken: matrix ${String(row[0]).split(":")[0]} accessories +$25`); }
    }
    if (broken && type === "features") {
      const i = headers.indexOf("Upgrade Plus Adds");
      const n = rows.findIndex((r, k) => k > 0 && Number(r[i]) > 0 && String(r[0]).startsWith(stores[Math.min(2, stores.length - 1)].store_number + ":"));
      if (n > 0) { console.log(`Broken: features file missing a rep at store ${String(rows[n][0]).split(":")[0]}`); rows.splice(n, 1); }
    }
    rows.push(headers.map((h, i) => (i === 0 ? "Total" : totals[i] ? Math.round(totals[i] * 100) / 100 : null)));
    rows.push([filters]);
    const names = { matrix: "Detailed Matrix.xlsx", fees: "Fee Report.xlsx", retention: "Retention.xlsx", chi: "CHI Report.xlsx", features: "Features Report.xlsx" };
    await write(names[type], rows);
  }
  console.log(`Wrote 7 files for ${dealer.name} (${stores.length} stores, ${reps.length} rep rows) to ${outDir}/`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
