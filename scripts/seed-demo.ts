/**
 * Sample-data generator. Creates two made-up dealers with made-up people:
 *
 *   Sunrise Wireless       4 stores, Dealer > District > Store (Region and Area skipped)
 *   Pacific Coast Mobile   1,000 stores, Dealer > Territory > Market > District > Store
 *
 * ...plus about 90 days of month-to-date numbers per rep and store, goals, and an
 * official "Store KPI Report". Names come from generic lists; no real rep or
 * customer data is used. Re-running replaces both demo dealers.
 *
 *   npm run db:seed
 */
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";
import { KPI_CATALOG } from "../src/lib/kpis/catalog";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
const sql = postgres(url, { max: 4, onnotice: () => {} });

// Data runs from START through END ("numbers through" dates).
const START = "2026-08-01";
const END = process.env.SEED_END_DATE ?? "2026-10-30";

// ---------------------------------------------------------------------------
// Random helpers (seeded, so every run produces the same demo data)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(42);
const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}
function binomial(n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
}
function gauss() {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Made-up names and places
// ---------------------------------------------------------------------------

const FIRST = `Aaron Abby Adrian Aiden Alana Alexis Alicia Amara Amir Andre Andrea Angela Ariana Arturo Ashley Austin
Avery Bianca Blake Brandon Brenda Brianna Caleb Camila Carla Carlos Carmen Cesar Chloe Chris Cindy Clara Cody Cole
Connor Cristina Dakota Damian Dana Darius Dean Derek Destiny Devin Diana Diego Dominic Dylan Eden Edgar Elena Eli
Elisa Emily Emma Enrique Eric Erika Ethan Eva Evan Fabian Faith Felix Fiona Gabriel Gavin Gina Grace Hailey Hector
Heidi Henry Hugo Ian Ivan Ivy Jada Jaden Jake Jamal Jasmine Javier Jenna Jesse Joel Jonah Jordan Jorge Joy Julia
Julian Kai Karen Karina Kayla Keith Kevin Kiara Kyle Lance Laura Leo Liam Lila Lily Logan Lorena Lucas Lucia Luis
Luna Maddie Marco Maria Mario Marisol Mason Maya Megan Mia Miguel Mila Monica Nadia Naomi Nathan Nia Nick Noah Nora
Oliver Olivia Omar Oscar Owen Paige Pablo Paola Parker Peter Priya Quinn Rafael Rachel Raul Reed Renee Ricky Riley
Rita Rosa Ruby Ryan Sabrina Sasha Sean Selena Seth Sierra Simon Sofia Stella Tanya Tara Tessa Theo Tina Tony Trent
Troy Uriel Valeria Vanessa Victor Vince Wade Wesley Willa Xavier Yara Yvette Zane Zara Zoe`.split(/\s+/);

const LAST = `Abbott Acosta Adler Aguilar Alvarez Archer Arias Avila Baker Banks Barajas Barnes Bell Benson Blair Bowen
Bravo Brooks Bryce Burke Cabrera Calder Camacho Campos Cano Carr Castillo Chan Chavez Cho Cole Contreras Cortez Cross
Cruz Dalton Daniels Delgado Diaz Dixon Duarte Duran Ellis Espinoza Estrada Farley Fernandez Fischer Flores Ford
Franco Fuentes Gallo Garza Gibson Gill Gomez Grant Graves Guerra Gutierrez Hale Hayes Herrera Hicks Holt Ibarra Ingram
Jensen Jimenez Kang Keller Kim Knox Lam Lane Lara Le Lin Lopez Lucero Luna Macias Maddox Marin Marsh Medina Mejia Mendez
Meyer Miles Molina Monroe Mora Moreno Nash Navarro Nguyen Nolan Novak Ochoa Ortega Ortiz Pace Park Patel Pena Perez
Pham Pierce Quinn Ramos Reed Reyes Rios Rivas Romero Rosales Ross Ruiz Salas Santos Shah Silva Soto Stone Suarez
Tang Torres Tran Trujillo Vance Vargas Vega Wade Walsh Ward Wolfe Wong Yates Young Zamora Zhang`.split(/\s+/);

const CITIES = `Alder Springs|Bayview|Bellmont|Brookfield|Cedar Grove|Clearwater|Coral Bay|Crestline|Dover Hills|Eastgate|
Elm Park|Fairhaven|Falcon Ridge|Glenwood|Golden Valley|Granite Falls|Harbor Point|Hillcrest|Ironwood|Juniper|Kingsport|
Lakeside|Laurel Heights|Linden|Maple Grove|Marina Vista|Meadowbrook|Mesa Verde|Millbrook|Northridge|Oak Hollow|
Ocean Park|Palm Crest|Pine Valley|Pinecrest|Quail Run|Redwood|Ridgeview|Riverside Park|Rose Hill|Sagebrush|Sandpoint|
Shadow Hills|Silver Lake|South Bend|Spring Valley|Stonegate|Sunset Ridge|Tamarack|Twin Oaks|Valley View|Westfield|
Willow Creek|Windmere`.split("|").map((s) => s.trim());
const STREETS = "Main St|Oak Ave|Center Blvd|Market St|Park Ave|Valley Rd|Lake Dr|Grand Ave|Broadway|Mission Rd|Plaza Dr|Pacific Ave|Sunset Blvd|Mountain View Rd|Highland Ave".split("|");
const TERRITORIES = ["North", "South", "East", "West", "Central"];

// ---------------------------------------------------------------------------
// Dealer definitions
// ---------------------------------------------------------------------------

interface DealerConfig {
  slug: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  levels: { level_key: string; label: string; enabled: boolean; depth: number }[];
  /** territories x markets x districts x stores; 0 means the level is skipped */
  shape: { regions: number; areas: number; districts: number; stores: number };
  firstStoreNumber: number;
  repsPerStore: [number, number];
  multiStoreShare: number;
  codePrefix: string;
}

const DEALERS: DealerConfig[] = [
  {
    slug: "sunrise",
    name: "Sunrise Wireless",
    primaryColor: "#c2410c",
    accentColor: "#0369a1",
    levels: [
      { level_key: "dealer", label: "Company", enabled: true, depth: 0 },
      { level_key: "region", label: "Region", enabled: false, depth: 1 },
      { level_key: "area", label: "Area", enabled: false, depth: 2 },
      { level_key: "district", label: "District", enabled: true, depth: 3 },
      { level_key: "store", label: "Store", enabled: true, depth: 4 },
    ],
    shape: { regions: 0, areas: 0, districts: 1, stores: 4 },
    firstStoreNumber: 101,
    repsPerStore: [3, 4],
    multiStoreShare: 0.25,
    codePrefix: "SW",
  },
  {
    slug: "pacific-coast",
    name: "Pacific Coast Mobile",
    primaryColor: "#0f766e",
    accentColor: "#7c3aed",
    levels: [
      { level_key: "dealer", label: "Company", enabled: true, depth: 0 },
      { level_key: "region", label: "Territory", enabled: true, depth: 1 },
      { level_key: "area", label: "Market", enabled: true, depth: 2 },
      { level_key: "district", label: "District", enabled: true, depth: 3 },
      { level_key: "store", label: "Store", enabled: true, depth: 4 },
    ],
    shape: { regions: 5, areas: 4, districts: 10, stores: 5 },
    firstStoreNumber: 1001,
    repsPerStore: [8, 12],
    multiStoreShare: 0.08,
    codePrefix: "PC",
  },
];

// ---------------------------------------------------------------------------
// Simulation: month-to-date counters per rep-at-store, summed up to stores
// ---------------------------------------------------------------------------

type Counters = Record<string, number>;
const COUNTER_KEYS = `acts upg chi_ga chi_orders chi_checked chi_eligible chi_credit chi_adv plan35 plan40 plan50 plan60s
simply watch byod aal multi maxatt port_in port_out bill_pay cust_assist plan_up30 plan_down30 fs_ga fs_upg ap_opp
ap_enr pr_opp pr_add up_opp up_add hs_opp hs_add ild_opp ild_add acc_rev ppp_acc ppp_links ppp_apps bread_sub bread prog act_fees act_disc
act_disc_rev act_waived act_waived_rev act_collected upg_fees upg_disc upg_disc_rev upg_waived upg_waived_rev
wtr_n wtr_sum`.split(/\s+/);
const emptyCounters = (): Counters => Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0]));

interface Rep {
  personId: number;
  skill: number;
  autopay: number; // personal tendencies, so rankings look realistic
  protect: number;
  upgPlus: number;
  waive: number;
  wtr: number;
  accessory: number;
}
interface RepAtStore {
  rep: Rep;
  storeId: number;
  share: number; // share of the store's traffic
  c: Counters;
}
interface StoreSim {
  storeId: number;
  traffic: number;
  reps: RepAtStore[];
  c: Counters;
  bop: number;
  disconnects: number;
  suspendedPct: number;
  retentionRate: number;
}

const WEEKDAY = [1.0, 0.9, 0.85, 0.9, 0.95, 1.15, 1.35]; // Sun..Sat

/** Adds one day of sales for a rep at a store into both the rep and store counters. */
function simulateDay(r: RepAtStore, s: StoreSim, dayFactor: number) {
  if (rand() > 0.72) return; // day off
  const rep = r.rep;
  const lam = 2.6 * s.traffic * r.share * rep.skill * dayFactor / 0.72;
  const acts = poisson(lam);
  const upg = poisson(lam * 0.22);
  const inc: Counters = {};
  const add = (k: string, v: number) => {
    if (v) inc[k] = (inc[k] ?? 0) + v;
  };
  add("acts", acts);
  add("upg", upg);
  // plan mix
  for (let i = 0; i < acts; i++) {
    const x = rand();
    add(x < 0.02 ? "plan35" : x < 0.07 ? "plan40" : x < 0.33 ? "plan50" : "plan60s", 1);
  }
  add("simply", poisson(lam * 0.02));
  add("watch", poisson(lam * 0.03));
  add("byod", binomial(acts, 0.2));
  add("aal", binomial(acts, 0.36));
  add("multi", binomial(acts, 0.52));
  add("maxatt", binomial(acts, 0.1));
  add("port_in", binomial(acts, 0.38));
  add("port_out", poisson(lam * 0.05));
  add("bill_pay", poisson(4 * s.traffic * r.share * dayFactor / 0.72));
  add("cust_assist", poisson(1.2 * s.traffic * r.share / 0.72));
  add("plan_up30", poisson(lam * 0.04));
  add("plan_down30", poisson(lam * 0.02));
  add("fs_ga", poisson(lam * 0.01));
  add("fs_upg", poisson(lam * 0.01));
  // features
  const opps = acts + upg;
  add("ap_opp", opps);
  add("ap_enr", binomial(opps, rep.autopay));
  add("pr_opp", opps);
  add("pr_add", binomial(opps, rep.protect));
  add("up_opp", upg);
  add("up_add", binomial(upg, rep.upgPlus));
  add("hs_opp", acts);
  add("hs_add", binomial(acts, 0.05));
  add("ild_opp", acts);
  add("ild_add", binomial(acts, 0.08));
  let acc = 0;
  for (let i = 0; i < opps; i++) if (rand() < 0.55) acc += between(10, 70) * rep.accessory;
  add("acc_rev", Math.round(acc * 100) / 100);
  const links = poisson(lam * 0.15);
  add("ppp_links", links);
  const breadSub = binomial(links, 0.5);
  add("ppp_apps", binomial(links, 0.8));
  add("bread_sub", breadSub);
  add("bread", binomial(breadSub, 0.6));
  add("prog", binomial(links, 0.25));
  add("ppp_acc", Math.round(acc * between(0, 0.15) * 100) / 100);
  // fees ($35 activation / $35 upgrade; discounted = $15 off, waived = $35 off)
  const actWaived = binomial(acts, rep.waive);
  const actDisc = binomial(acts - actWaived, 0.15);
  add("act_fees", acts);
  add("act_waived", actWaived);
  add("act_waived_rev", actWaived * 35);
  add("act_disc", actDisc);
  add("act_disc_rev", actDisc * 20);
  add("act_collected", (acts - actWaived - actDisc) * 35 + actDisc * 20);
  const upgWaived = binomial(upg, rep.waive);
  const upgDisc = binomial(upg - upgWaived, 0.15);
  add("upg_fees", upg);
  add("upg_waived", upgWaived);
  add("upg_waived_rev", upgWaived * 35);
  add("upg_disc", upgDisc);
  add("upg_disc_rev", upgDisc * 20);
  // home internet funnel
  const checked = poisson(3 * s.traffic * r.share * rep.skill / 0.72);
  const eligible = binomial(checked, 0.55);
  const credit = binomial(eligible, 0.5);
  const orders = binomial(credit, 0.4);
  add("chi_checked", checked);
  add("chi_eligible", eligible);
  add("chi_credit", credit);
  add("chi_adv", binomial(credit, 0.2));
  add("chi_orders", orders);
  add("chi_ga", binomial(orders, 0.8));
  // surveys
  const surveys = binomial(acts, 0.25);
  add("wtr_n", surveys);
  add("wtr_sum", binomial(surveys, rep.wtr));

  for (const k in inc) {
    r.c[k] += inc[k];
    s.c[k] += inc[k];
  }
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** KPIs that only exist on the store-level MTD report (no rep column in any file). */
const STORE_ONLY = ["ppp_apps_submitted", "ppp_accessory_sales", "progressive_rebates", "bread_submitted", "bread_approved"];
function repKpis(c: Counters) {
  const m = toKpis(c);
  for (const k of STORE_ONLY) delete m[k];
  return m;
}

/** Turns counters into the KPI map exactly as the Power BI files would report it. */
function toKpis(c: Counters): Record<string, number> {
  const out: Record<string, number> = {};
  const set = (k: string, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v) && v !== 0) out[k] = v;
  };
  const pct = (n: number, d: number) => (d > 0 ? r4(n / d) : undefined);
  out.activations = c.acts + c.chi_ga; // TCGA, as on the MTD report
  out.upgrades = c.upg;
  set("wireless_gross_adds", c.acts);
  set("accessory_revenue", r2(c.acc_rev));
  set("accessory_rev_per_opp", c.acts + c.upg > 0 ? r2(c.acc_rev / (c.acts + c.upg)) : undefined);
  set("port_in", c.port_in);
  set("port_out", c.port_out);
  set("bill_payments", c.bill_pay);
  set("customer_assist_fees", c.cust_assist);
  set("plan_upgrades_30d", c.plan_up30);
  set("plan_downgrades_30d", c.plan_down30);
  set("free_ship_gross_adds", c.fs_ga);
  set("free_ship_upgrades", c.fs_upg);
  set("wtr", pct(c.wtr_sum, c.wtr_n));
  set("byod_pct", pct(c.byod, c.acts));
  set("add_a_line_pct", pct(c.aal, c.acts));
  set("multiline_pct", pct(c.multi, c.acts));
  set("plan_35", c.plan35);
  set("plan_40", c.plan40);
  set("plan_50", c.plan50);
  set("plan_60_supreme", c.plan60s);
  set("plan_60_plus_mix", pct(c.plan60s, c.acts));
  set("simply_data", c.simply);
  set("watch_activations", c.watch);
  set("max_attach_rate", pct(c.maxatt, c.acts));
  set("autopay_opps", c.ap_opp);
  set("autopay_enrollments", c.ap_enr);
  set("protect_opps", c.pr_opp);
  set("protect_adds", c.pr_add);
  set("upgrade_plus_opps", c.up_opp);
  set("upgrade_plus_adds", c.up_add);
  set("hotspot_opps", c.hs_opp);
  set("hotspot_adds", c.hs_add);
  set("ild_opps", c.ild_opp);
  set("ild_adds", c.ild_add);
  set("ppp_links_sent", c.ppp_links);
  set("bread_leases", c.bread);
  set("progressive_leases", c.prog);
  set("ppp_attach_rate", pct(c.bread + c.prog, c.acts + c.upg));
  set("ppp_apps_submitted", c.ppp_apps);
  set("ppp_accessory_sales", r2(c.ppp_acc));
  set("progressive_rebates", c.prog);
  set("bread_submitted", c.bread_sub);
  set("bread_approved", c.bread);
  set("activation_fees", c.act_fees);
  set("act_fees_discounted", c.act_disc);
  set("act_fees_discounted_rev", c.act_disc_rev);
  set("act_fees_waived", c.act_waived);
  set("act_fees_waived_rev", c.act_waived_rev);
  set("avg_act_fee_collected", c.act_fees > 0 ? r2(c.act_collected / c.act_fees) : undefined);
  set("upgrade_fees", c.upg_fees);
  set("upg_fees_discounted", c.upg_disc);
  set("upg_fees_discounted_rev", c.upg_disc_rev);
  set("upg_fees_waived", c.upg_waived);
  set("upg_fees_waived_rev", c.upg_waived_rev);
  set("port_in_ga_pct", pct(c.port_in, c.acts));
  set("chi_orders", c.chi_orders);
  set("chi_gross_adds", c.chi_ga);
  set("chi_addresses_checked", c.chi_checked);
  set("chi_addresses_eligible", c.chi_eligible);
  set("chi_credit_checked", c.chi_credit);
  set("chi_adv_payment_required", c.chi_adv);
  return out;
}

function storeKpis(s: StoreSim, dayOfMonth: number): Record<string, number> {
  const m = toKpis(s.c);
  const vol = Math.round(s.disconnects * 0.6);
  m.open_stores = 1;
  m.bop_subscribers = s.bop;
  m.net_disconnects = -s.disconnects;
  m.net_adds = s.c.acts - s.disconnects;
  m.eop_subscribers = s.bop + m.net_adds;
  m.voluntary_churn = vol;
  m.involuntary_churn = s.disconnects - vol;
  m.churn_rate = r4(s.disconnects / s.bop);
  m.retention_rate = r4(clamp(s.retentionRate + 0.01 * gauss() / Math.sqrt(dayOfMonth), 0.6, 0.95));
  m.eop_suspended = Math.round(s.bop * s.suspendedPct);
  return m;
}

// ---------------------------------------------------------------------------
// Database writes
// ---------------------------------------------------------------------------

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function insertUnits(dealerId: number, rows: { level_key: string; name: string; code: string; parent_id: number | null }[]) {
  const ids = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000).map((r) => ({ ...r, dealer_id: dealerId, path: "tmp" }));
    const res = await sql<{ id: number; code: string }[]>`
      insert into org_units ${sql(chunk, "dealer_id", "parent_id", "level_key", "name", "code", "path")}
      returning id, code`;
    for (const r of res) ids.set(r.code, r.id);
  }
  return ids;
}

async function seedDealer(cfg: DealerConfig, dealerIndex: number) {
  rand = mulberry32(1000 + dealerIndex);
  const t0 = Date.now();
  console.log(`\n${cfg.name}`);
  const [old] = await sql<{ id: number }[]>`select id from dealers where slug = ${cfg.slug}`;
  if (old) {
    // Fact tables are partitioned and carry no foreign keys, so clear them first.
    for (const t of ["rep_daily_mtd", "store_daily_mtd", "org_rollup_daily"]) await sql`delete from ${sql(t)} where dealer_id = ${old.id}`;
    await sql`delete from dealers where id = ${old.id}`;
  }

  const [dealer] = await sql<{ id: number }[]>`
    insert into dealers (slug, name, primary_color, accent_color, settings)
    values (${cfg.slug}, ${cfg.name}, ${cfg.primaryColor}, ${cfg.accentColor},
            ${sql.json({ demo: true, fiscal_month_start_day: 1 })})
    returning id`;
  const dealerId = dealer.id;
  await sql`insert into dealer_org_levels ${sql(cfg.levels.map((l) => ({ ...l, dealer_id: dealerId })))}`;

  // --- org tree ---
  const [root] = await sql<{ id: number }[]>`
    insert into org_units (dealer_id, parent_id, level_key, name, code, path)
    values (${dealerId}, null, 'dealer', ${cfg.name}, 'HQ', 'tmp') returning id`;
  await sql`update org_units set path = text2ltree('u' || id) where id = ${root.id}`;

  const { regions, areas, districts, stores } = cfg.shape;
  const cities = shuffle([...CITIES]);
  const regionRows = Array.from({ length: regions }, (_, i) => ({
    level_key: "region", name: `${TERRITORIES[i % TERRITORIES.length]} Territory`, code: `R${i + 1}`, parent_id: root.id,
  }));
  const regionIds = await insertUnits(dealerId, regionRows);
  const areaRows = regionRows.flatMap((r, ri) =>
    Array.from({ length: areas }, (_, ai) => ({
      level_key: "area", name: `${cities[(ri * areas + ai) % cities.length]} Market`, code: `A${ri + 1}${ai + 1}`,
      parent_id: regionIds.get(r.code)!,
    })),
  );
  const areaIds = await insertUnits(dealerId, areaRows);
  const districtParents = areaRows.length ? areaRows.map((a) => areaIds.get(a.code)!) : [root.id];
  let dn = 0;
  const districtRows = districtParents.flatMap((parentId) =>
    Array.from({ length: districts }, () => {
      dn++;
      return { level_key: "district", name: `District ${String(dn).padStart(3, "0")}`, code: `D${dn}`, parent_id: parentId };
    }),
  );
  const districtIds = await insertUnits(dealerId, districtRows);
  let sn = cfg.firstStoreNumber;
  const storeRows = districtRows.flatMap((d) =>
    Array.from({ length: stores }, () => {
      const num = String(sn++);
      return { level_key: "store", name: `${pick(CITIES)} - ${pick(STREETS)}`, code: num, parent_id: districtIds.get(d.code)! };
    }),
  );
  const storeIds = await insertUnits(dealerId, storeRows);

  // Set ltree paths level by level (parent path + own id).
  for (const level of ["region", "area", "district", "store"]) {
    await sql`
      update org_units c set path = p.path || text2ltree('u' || c.id)
        from org_units p
       where c.parent_id = p.id and c.dealer_id = ${dealerId} and c.level_key = ${level}`;
  }

  const storeList = storeRows.map((s) => ({ id: storeIds.get(s.code)!, number: s.code, name: s.name, districtCode: "" }));
  const districtOfStore = new Map<number, number>();
  for (const s of storeRows) districtOfStore.set(storeIds.get(s.code)!, s.parent_id);

  const hoursLong = { mon: ["10:00", "20:00"], tue: ["10:00", "20:00"], wed: ["10:00", "20:00"], thu: ["10:00", "20:00"], fri: ["10:00", "20:00"], sat: ["10:00", "20:00"], sun: ["10:00", "19:00"] };
  const hoursShort = { mon: ["10:00", "19:00"], tue: ["10:00", "19:00"], wed: ["10:00", "19:00"], thu: ["10:00", "19:00"], fri: ["10:00", "19:00"], sat: ["10:00", "19:00"], sun: ["10:00", "18:00"] };
  const storeDetailRows = storeList.map((s) => ({
    org_unit_id: s.id,
    dealer_id: dealerId,
    store_number: s.number,
    sales_code: String(80220000 + Number(s.number)),
    address: `${100 + Math.floor(rand() * 9800)} ${s.name.split(" - ")[1]}`,
    city: s.name.split(" - ")[0],
    state: "CA",
    opened_on: `20${String(10 + Math.floor(rand() * 15))}-0${1 + Math.floor(rand() * 9)}-15`,
    hours: sql.json(rand() < 0.3 ? hoursLong : hoursShort),
  }));
  for (let i = 0; i < storeDetailRows.length; i += 1000) {
    await sql`insert into stores ${sql(storeDetailRows.slice(i, i + 1000))}`;
  }
  console.log(`  org tree: ${regionRows.length} ${cfg.levels[1].label.toLowerCase()} units, ${areaRows.length} ${cfg.levels[2].label.toLowerCase()} units, ${districtRows.length} districts, ${storeList.length} stores`);

  // --- people ---
  const combos = shuffle(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`)));
  let nameIdx = 0;
  const people: { display_name: string; employee_code: string; hidden_from_rep_views: boolean; storeIdx: number }[] = [];
  storeList.forEach((_, si) => {
    const n = Math.round(between(cfg.repsPerStore[0], cfg.repsPerStore[1]));
    for (let i = 0; i < n; i++) {
      people.push({ display_name: combos[nameIdx++], employee_code: `${cfg.codePrefix}${100000 + nameIdx}`, hidden_from_rep_views: false, storeIdx: si });
    }
  });
  // One selling manager per district, hidden from rep views (counts in totals only).
  const managerStore = new Map<number, number>();
  districtRows.forEach((d) => {
    const districtId = districtIds.get(d.code)!;
    const si = storeList.findIndex((s) => districtOfStore.get(s.id) === districtId);
    managerStore.set(people.length, si);
    people.push({ display_name: combos[nameIdx++], employee_code: `${cfg.codePrefix}${100000 + nameIdx}`, hidden_from_rep_views: true, storeIdx: si });
  });
  const personIds: number[] = [];
  for (let i = 0; i < people.length; i += 5000) {
    const chunk = people.slice(i, i + 5000).map(({ display_name, employee_code, hidden_from_rep_views }) => ({
      dealer_id: dealerId, display_name, employee_code, hidden_from_rep_views,
    }));
    const res = await sql<{ id: number }[]>`insert into people ${sql(chunk)} returning id`;
    personIds.push(...res.map((r) => r.id));
  }
  const aliasRows = people.map((p, i) => ({ dealer_id: dealerId, raw_name: `${p.display_name.toUpperCase()} - ${p.employee_code.toLowerCase()}`, person_id: personIds[i] }));
  for (let i = 0; i < aliasRows.length; i += 5000) await sql`insert into person_aliases ${sql(aliasRows.slice(i, i + 5000))}`;

  // --- simulation setup ---
  const sims: StoreSim[] = storeList.map((s) => ({
    storeId: s.id,
    traffic: clamp(Math.exp(0.35 * gauss()), 0.45, 2.2),
    reps: [],
    c: emptyCounters(),
    bop: Math.round(between(1800, 3600)),
    disconnects: 0,
    suspendedPct: between(0.02, 0.05),
    retentionRate: between(0.72, 0.86),
  }));
  const assignments: { dealer_id: number; person_id: number; store_id: number; is_primary: boolean; start_date: string }[] = [];
  const reps: Rep[] = people.map((p, i) => {
    const hidden = p.hidden_from_rep_views;
    return {
      personId: personIds[i],
      skill: hidden ? 0.5 : clamp(Math.exp(0.3 * gauss()), 0.45, 1.9),
      autopay: clamp(between(0.55, 0.88), 0, 1),
      protect: between(0.22, 0.55),
      upgPlus: between(0.15, 0.5),
      waive: between(0.02, 0.15),
      wtr: between(0.72, 0.97),
      accessory: between(0.6, 1.5),
    };
  });
  people.forEach((p, i) => {
    const sim = sims[p.storeIdx];
    sim.reps.push({ rep: reps[i], storeId: sim.storeId, share: p.hidden_from_rep_views ? 0.3 : 1, c: emptyCounters() });
    assignments.push({ dealer_id: dealerId, person_id: personIds[i], store_id: sim.storeId, is_primary: true, start_date: START });
  });
  // Some reps also work a second store in the same district (combined under one name in rep views).
  people.forEach((p, i) => {
    if (p.hidden_from_rep_views || rand() > cfg.multiStoreShare) return;
    const home = storeList[p.storeIdx];
    const siblings = storeList.map((s, si) => ({ s, si })).filter(({ s }) => s.id !== home.id && districtOfStore.get(s.id) === districtOfStore.get(home.id));
    if (!siblings.length) return;
    const { si } = pick(siblings);
    sims[si].reps.push({ rep: reps[i], storeId: sims[si].storeId, share: 0.35, c: emptyCounters() });
    assignments.push({ dealer_id: dealerId, person_id: personIds[i], store_id: sims[si].storeId, is_primary: false, start_date: START });
  });
  for (let i = 0; i < assignments.length; i += 5000) await sql`insert into store_assignments ${sql(assignments.slice(i, i + 5000))}`;
  for (const s of sims) {
    const total = s.reps.reduce((a, r) => a + r.share * r.rep.skill, 0);
    for (const r of s.reps) r.share = r.share / total;
  }
  const multi = new Set(assignments.filter((a) => !a.is_primary).map((a) => a.person_id)).size;
  console.log(`  people: ${people.length} (${managerStore.size} hidden selling managers, ${multi} reps at 2 stores)`);

  // --- goals (per store per month) and dealer-wide rate goals ---
  const dates = dateRange(START, END);
  const months = [...new Set(dates.map((d) => d.slice(0, 7) + "-01"))];
  const goalRows: { dealer_id: number; org_unit_id: number; month: string; kpi_code: string; target: number; source: string; goal_set: string }[] = [];
  const goal = (org_unit_id: number, month: string, kpi_code: string, target: number, source: string, goal_set = "dealer") =>
    goalRows.push({ dealer_id: dealerId, org_unit_id, month, kpi_code, target, source, goal_set });
  for (const month of months) {
    for (const s of sims) {
      const expActs = 2.6 * s.traffic * 30;
      const a = Math.round(expActs * between(0.95, 1.15));
      goal(s.storeId, month, "activations", a, "import");
      goal(s.storeId, month, "upgrades", Math.round(a * 0.22), "import");
      goal(s.storeId, month, "accessory_revenue", Math.round(a * 1.22 * 22 / 100) * 100, "import");
      goal(s.storeId, month, "chi_orders", Math.max(2, Math.round(a * 0.08)), "import");
      goal(s.storeId, month, "activations", Math.round(a * between(0.85, 1.0)), "import", "cricket");
      goal(s.storeId, month, "wireless_gross_adds", Math.round(a * between(0.8, 0.95)), "import", "cricket");
    }
    for (const [kpi, target] of [["autopay_rate", 0.75], ["protect_rate", 0.4], ["upgrade_plus_rate", 0.33], ["wtr", 0.85], ["act_fees_waived_rate", 0.08]] as const) {
      goal(root.id, month, kpi, target, "manual");
    }
  }
  for (let i = 0; i < goalRows.length; i += 5000) await sql`insert into kpi_goals ${sql(goalRows.slice(i, i + 5000))}`;

  // --- one generator "import batch" per day ---
  const batchRows = dates.map((d) => ({ dealer_id: dealerId, biz_date: d, status: "done", progress: 100, source: "generator" }));
  const batches = await sql<{ id: number; biz_date: Date }[]>`insert into import_batches ${sql(batchRows)} returning id, biz_date`;
  const batchByDate = new Map(batches.map((b) => [b.biz_date.toISOString().slice(0, 10), b.id]));

  // --- simulate day by day, streaming rep rows into the database ---
  const storeLines: string[] = [];
  let repRowCount = 0;
  async function* repRows() {
    let month = "";
    for (const date of dates) {
      const d = new Date(date + "T00:00:00Z");
      const dom = d.getUTCDate();
      if (date.slice(0, 7) !== month) {
        month = date.slice(0, 7);
        for (const s of sims) {
          if (s.c.acts) s.bop = s.bop + s.c.acts - s.disconnects;
          s.c = emptyCounters();
          s.disconnects = 0;
          for (const r of s.reps) r.c = emptyCounters();
        }
      }
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const dayFactor = WEEKDAY[d.getUTCDay()] * (dom > daysInMonth - 3 ? 1.2 : 1) * (dom <= 2 ? 0.85 : 1);
      const batchId = batchByDate.get(date)!;
      let chunk = "";
      for (const s of sims) {
        for (const r of s.reps) simulateDay(r, s, dayFactor);
        s.disconnects += poisson(s.bop * 0.0007);
        for (const r of s.reps) {
          chunk += `${dealerId}\t${date}\t${s.storeId}\t${r.rep.personId}\t${JSON.stringify(repKpis(r.c))}\t${batchId}\n`;
          repRowCount++;
        }
        storeLines.push(`${dealerId}\t${date}\t${s.storeId}\t${JSON.stringify(storeKpis(s, dom))}\t${batchId}\n`);
      }
      yield chunk;
    }
  }
  const repCopy = await sql`copy rep_daily_mtd (dealer_id, biz_date, store_id, person_id, m, import_batch_id) from stdin`.writable();
  await pipeline(Readable.from(repRows()), repCopy);
  const storeCopy = await sql`copy store_daily_mtd (dealer_id, biz_date, store_id, m, import_batch_id) from stdin`.writable();
  await pipeline(Readable.from(storeLines), storeCopy);
  console.log(`  numbers: ${dates.length} days, ${repRowCount.toLocaleString()} rep rows, ${storeLines.length.toLocaleString()} store rows`);

  // --- pre-added totals, month by month ---
  let rollupRows = 0;
  for (const month of months) {
    const from = month;
    const end = new Date(month + "T00:00:00Z");
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const [{ n }] = await sql<{ n: number }[]>`select refresh_rollups(${dealerId}, ${from}::date, ${end.toISOString().slice(0, 10)}::date) as n`;
    rollupRows += n;
  }
  console.log(`  pre-added totals: ${rollupRows.toLocaleString()} rows`);

  // --- an official report as a starting point for the report builder ---
  const [report] = await sql<{ id: number }[]>`
    insert into saved_reports (dealer_id, owner_user_id, name, row_level, is_official)
    values (${dealerId}, null, 'Store KPI Report', 'store', true) returning id`;
  const reportKpis = ["activations", "upgrades", "wireless_gross_adds", "accessory_revenue", "autopay_rate", "protect_rate", "upgrade_plus_rate", "chi_gross_adds", "wtr", "act_fees_waived_rate"];
  await sql`insert into saved_report_kpis ${sql(reportKpis.map((k, i) => ({ report_id: report.id, kpi_code: k, position: i })))}`;

  await sql`insert into audit_log (dealer_id, action, entity, details)
            values (${dealerId}, 'demo.seeded', 'dealer', ${sql.json({ stores: storeList.length, people: people.length, from: START, to: END })})`;
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main() {
  const known = new Set(KPI_CATALOG.map((k) => k.code));
  const probe = toKpis(Object.fromEntries(COUNTER_KEYS.map((k) => [k, 1])));
  const unknown = Object.keys(probe).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`Generator uses KPIs missing from the catalog: ${unknown.join(", ")}`);

  await sql`select ensure_month_partitions(${START}::date, ${END}::date)`;
  for (const [i, cfg] of DEALERS.entries()) await seedDealer(cfg, i);
  await sql`analyze`;
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
