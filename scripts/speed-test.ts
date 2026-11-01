/**
 * Speed test: opens every screen as each role on the 1,000-store demo dealer and times it,
 * then 25 people at once, then a full upload. Writes the results to docs/SPEED.md.
 * The app must be running (npm run build && npm start).
 *
 *   npm run speed-test
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const BASE = process.env.SPEED_BASE_URL ?? "http://localhost:3000";
const SLUG = "pacific-coast";
const RUNS = 5;
const BUDGET_MS = 2000;
const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => {} });

const one = async <T>(q: Promise<T[]>) => (await q)[0];

async function sessionFor(email: string) {
  const token = randomBytes(32).toString("base64url");
  const { id } = await one(sql<{ id: number }[]>`select id from users where email = ${email}`);
  await sql`insert into sessions (id, user_id, expires_at)
            values (${createHash("sha256").update(token).digest("hex")}, ${id}, now() + interval '1 hour')`;
  return `dd_session=${token}`;
}

async function time(cookie: string, path: string) {
  const t = performance.now();
  const r = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
  await r.arrayBuffer();
  return { ms: performance.now() - t, status: r.status };
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function main() {
  // Places to visit, along one branch of the tree.
  const store = await one(sql<{ id: number; path: string }[]>`select org_unit_id as id, (select path::text from org_units where id = org_unit_id) as path from stores where store_number = '1852'`);
  const up = async (level: string) => (await one(sql<{ id: number }[]>`select id from org_units where path @> ${store.path}::ltree and level_key = ${level}`)).id;
  const [district, area, region] = [await up("district"), await up("area"), await up("region")];
  const rep = (await one(sql<{ person_id: number }[]>`select person_id from users where email = 'rep@pacific-coast.demo'`)).person_id;
  const batch = (await one(sql<{ id: number }[]>`select max(id) as id from import_batches where source = 'upload' and dealer_id = (select id from dealers where slug = ${SLUG})`)).id;
  const many = "activations,upgrades,wireless_gross_adds,accessory_revenue,autopay_rate,protect_rate,upgrade_plus_rate,ild_rate,hotspot_rate,chi_orders,chi_gross_adds,wtr,byod_pct,multiline_pct,add_a_line_pct,max_attach_rate,bill_payments,sales_per_10_bill_pays,ppp_funded,act_fees_waived_rate,upg_fees_waived_rate,net_adds,port_in,boxes,chi_check_rate";
  const d = `/d/${SLUG}`;

  const plan: { role: string; email: string; pages: [string, string][] }[] = [
    { role: "Dealer admin", email: "admin@pacific-coast.demo", pages: [
      ["Company overview", d], ["Company overview sorted by Autopay", `${d}?sort=autopay_rate`], ["Search 1,000 stores", `${d}?q=lake`],
      ["Territory overview", `${d}?unit=${region}`], ["Market overview", `${d}?unit=${area}`], ["District overview", `${d}?unit=${district}`],
      ["Store card", `${d}/store/${store.id}`], ["Rep card", `${d}/rep/${rep}`],
      ["KPI report: 1,000 stores (page 1)", `${d}/report?level=store`], ["KPI report: 1,000 stores (page 20)", `${d}/report?level=store&page=20`],
      ["KPI report: stores sorted by Autopay", `${d}/report?level=store&sort=autopay_rate`],
      ["KPI report: 25 KPIs × 1,000 stores", `${d}/report?level=store&kpis=${many}`],
      ["KPI report: ~11,000 reps sorted", `${d}/report?level=rep&sort=accessory_revenue`],
      ["KPI report: 25 KPIs × 11,000 reps", `${d}/report?level=rep&kpis=${many}&sort=autopay_rate`],
      ["Rankings: stores", `${d}/rankings?level=store&kpi=activations`], ["Rankings: stores by % of goal", `${d}/rankings?level=store&kpi=activations&by=pace`],
      ["Rankings: 11,000 reps by Autopay", `${d}/rankings?level=rep&kpi=autopay_rate`], ["Rankings: reps page 50", `${d}/rankings?level=rep&kpi=activations&page=50`],
      ["Opportunities: company", `${d}/opportunities`], ["Opportunities: district", `${d}/opportunities?unit=${district}`], ["Opportunities: store", `${d}/opportunities?unit=${store.id}`],
      ["Upload page", `${d}/upload`], ["Import history", `${d}/imports`], ...(batch ? [["Import detail", `${d}/imports/${batch}`] as [string, string]] : []),
      ["Settings: users", `${d}/settings/users`], ["Settings: people (10,000+)", `${d}/settings/people`], ["Settings: people search", `${d}/settings/people?q=lee`],
      ["Settings: store goals", `${d}/settings/goals`], ["Settings: rate targets", `${d}/settings/targets`], ["Settings: change history", `${d}/settings/history`],
    ] },
    { role: "Territory manager", email: "territory@pacific-coast.demo", pages: [
      ["Home (territory)", `${d}?unit=${region}`], ["KPI report: their stores", `${d}/report?level=store`], ["Rankings: their reps", `${d}/rankings?level=rep&kpi=activations`],
      ["Opportunities", `${d}/opportunities?unit=${region}`] ] },
    { role: "District manager", email: "district@pacific-coast.demo", pages: [
      ["Home (district)", `${d}?unit=${district}`], ["Store card", `${d}/store/${store.id}`], ["KPI report: reps", `${d}/report?level=rep`],
      ["Rankings: stores", `${d}/rankings?level=store&kpi=activations`], ["Opportunities", `${d}/opportunities?unit=${district}`] ] },
    { role: "Store manager", email: "store@pacific-coast.demo", pages: [
      ["Home (store card)", `${d}/store/${store.id}`], ["KPI report: reps", `${d}/report?level=rep`], ["Opportunities", `${d}/opportunities?unit=${store.id}`] ] },
    { role: "Rep", email: "rep@pacific-coast.demo", pages: [["Own card", `${d}/rep/${rep}`]] },
  ];

  const results: { role: string; page: string; median: number; max: number; status: number }[] = [];
  for (const p of plan) {
    const cookie = await sessionFor(p.email);
    for (const [name, path] of p.pages) {
      await time(cookie, path); // warm-up
      const runs: { ms: number; status: number }[] = [];
      for (let i = 0; i < RUNS; i++) runs.push(await time(cookie, path));
      const r = { role: p.role, page: name, median: median(runs.map((x) => x.ms)), max: Math.max(...runs.map((x) => x.ms)), status: runs[0].status };
      results.push(r);
      console.log(`${r.median > BUDGET_MS || r.status !== 200 ? "SLOW/ERR" : "ok      "} ${String(Math.round(r.median)).padStart(5)} ms (max ${String(Math.round(r.max)).padStart(5)})  ${r.status}  ${p.role}: ${name}`);
    }
  }

  // 25 people opening pages at the same time.
  const admin = await sessionFor("admin@pacific-coast.demo");
  const mix = plan[0].pages.slice(0, 21).map(([, path]) => path);
  const t0 = performance.now();
  const loads = await Promise.all(Array.from({ length: 25 }, (_, i) => time(admin, mix[i % mix.length])));
  const wall = performance.now() - t0;
  const sorted = loads.map((l) => l.ms).sort((a, b) => a - b);
  const load = { wall, p50: sorted[12], p95: sorted[23], max: sorted[24], errors: loads.filter((l) => l.status !== 200).length };
  console.log(`25 at once: all done in ${Math.round(wall)} ms; typical ${Math.round(load.p50)} ms, slowest ${Math.round(load.max)} ms, errors ${load.errors}`);

  // A full 1,000-store upload (runs in the background; the page stays usable).
  let upload: { seconds: number; status: string } | null = null;
  const dir = "samples/pacific-coast-2026-10-30";
  try {
    const form = new FormData();
    for (const f of readdirSync(dir)) form.append("files", new Blob([readFileSync(join(dir, f))]), f);
    form.append("date", "2026-10-30");
    const t = performance.now();
    const r = await fetch(`${BASE}/api/d/${SLUG}/imports`, { method: "POST", body: form, headers: { cookie: admin } });
    const { id } = await r.json() as { id: number };
    let status = "queued";
    while (["queued", "reading", "checking", "saving"].includes(status)) {
      await new Promise((res) => setTimeout(res, 500));
      status = (await (await fetch(`${BASE}/api/d/${SLUG}/imports/${id}`, { headers: { cookie: admin } })).json()).batch.status;
    }
    upload = { seconds: (performance.now() - t) / 1000, status };
    console.log(`Upload of 1,000 stores: ${upload.seconds.toFixed(1)} s (${status})`);
  } catch (e) {
    console.log(`Upload skipped (${(e as Error).message}). Run: npm run samples -- --dealer ${SLUG} --date 2026-10-30`);
  }

  const [{ reps, days, size }] = await sql<{ reps: number; days: number; size: string }[]>`
    select (select count(*)::int from rep_daily_mtd r join dealers d on d.id = r.dealer_id and d.slug = ${SLUG}) as reps,
           (select count(distinct biz_date)::int from store_daily_mtd s join dealers d on d.id = s.dealer_id and d.slug = ${SLUG}) as days,
           pg_size_pretty(pg_database_size(current_database())) as size`;
  const slow = results.filter((r) => r.median > BUDGET_MS || r.status !== 200);
  const md = [
    `# Speed test`,
    ``,
    `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against **${SLUG}**: 1,000 stores, ~11,000 reps, ${days} days of history`,
    `(${reps.toLocaleString()} rep rows, database ${size}). Each page: 1 warm-up, then median and slowest of ${RUNS} loads. Budget: ${BUDGET_MS / 1000} s.`,
    ``,
    slow.length ? `**${slow.length} page(s) over budget or failing.**` : `**Every page is under budget.**`,
    ``,
    `| Role | Page | Typical | Slowest |`,
    `|---|---|---:|---:|`,
    ...results.map((r) => `| ${r.role} | ${r.page} | ${(r.median / 1000).toFixed(2)} s | ${(r.max / 1000).toFixed(2)} s${r.status !== 200 ? ` (HTTP ${r.status})` : ""} |`),
    ``,
    `**25 people at once:** all done in ${(load.wall / 1000).toFixed(2)} s; typical ${(load.p50 / 1000).toFixed(2)} s, slowest ${(load.max / 1000).toFixed(2)} s, ${load.errors} errors.`,
    ``,
    upload ? `**Daily upload, 1,000 stores (7 files):** ${upload.seconds.toFixed(1)} s from upload to saved, in the background (${upload.status}).` : "",
    ``,
    `Machine: a small shared cloud container (4 CPUs), app and database on the same box.`,
  ].join("\n");
  writeFileSync("docs/SPEED.md", md + "\n");
  console.log("\nWrote docs/SPEED.md");
  await sql`delete from sessions where expires_at < now() + interval '61 minutes' and expires_at > now() + interval '59 minutes'`;
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
