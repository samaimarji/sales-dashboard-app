/**
 * Demo logins, one per role, for the two sample dealers. All use the password in the
 * DEMO_PASSWORD environment variable (set it in .env.local; it is never committed).
 *
 *   npm run db:demo-users
 */
import postgres from "postgres";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";

const url = process.env.DATABASE_ADMIN_URL;
const password = process.env.DEMO_PASSWORD ?? "";
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
const problem = passwordProblem(password);
if (problem) throw new Error(`Set DEMO_PASSWORD in .env.local first (${problem})`);
const sql = postgres(url, { max: 1, onnotice: () => {} });

type Spec = { email: string; name: string; role?: string; unit?: string; person?: "top-rep"; platform?: boolean };

async function main() {
  const hash = await hashPassword(password);
  const rows: string[][] = [];
  const add = async (dealerSlug: string | null, s: Spec) => {
    const [dealer] = dealerSlug ? await sql<{ id: number }[]>`select id from dealers where slug = ${dealerSlug}` : [null];
    let unitId: number | null = null;
    let personId: number | null = null;
    if (dealer && s.unit) {
      const [u] = await sql<{ id: number }[]>`select id from org_units where dealer_id = ${dealer.id} and ${sql.unsafe(s.unit)} limit 1`;
      unitId = u.id;
    }
    if (dealer && s.person) {
      // The top-selling visible rep at the store above.
      const [p] = await sql<{ person_id: number }[]>`
        select r.person_id from rep_daily_mtd r join people p on p.id = r.person_id and not p.hidden_from_rep_views
         where r.store_id = ${unitId} and r.biz_date = (select max(biz_date) from rep_daily_mtd where store_id = ${unitId})
         order by (r.m ->> 'activations')::numeric desc limit 1`;
      personId = p.person_id;
    }
    await sql`delete from users where lower(email) = ${s.email}`;
    const [u] = await sql<{ id: number }[]>`
      insert into users (email, full_name, password_hash, is_platform_admin, dealer_id, person_id)
      values (${s.email}, ${s.name}, ${hash}, ${!!s.platform}, ${dealer?.id ?? null}, ${personId}) returning id`;
    if (dealer && s.role) await sql`insert into user_roles (user_id, dealer_id, role, org_unit_id) values (${u.id}, ${dealer.id}, ${s.role}, ${unitId})`;
    rows.push([s.email, s.platform ? "Platform admin" : `${s.role} (${dealerSlug})`]);
  };

  // A demo platform admin (sees every dealer) only on a developer's own machine, never on a hosted site
  // where the demo password may be shared.
  if (process.env.NODE_ENV !== "production") await add(null, { email: "owner@demo.local", name: "Platform Owner", platform: true });
  else await sql`delete from users where lower(email) = 'owner@demo.local'`;
  // Pacific Coast Mobile: one login per level, all along the same branch of the tree.
  const store = "id = (select org_unit_id from stores where store_number = '1852')";
  await add("pacific-coast", { email: "admin@pacific-coast.demo", name: "Pat Admin", role: "dealer_admin", unit: "level_key = 'dealer'" });
  await add("pacific-coast", { email: "territory@pacific-coast.demo", name: "Terry Region", role: "region", unit: `path @> (select path from org_units where ${store}) and level_key = 'region'` });
  await add("pacific-coast", { email: "market@pacific-coast.demo", name: "Morgan Area", role: "area", unit: `path @> (select path from org_units where ${store}) and level_key = 'area'` });
  await add("pacific-coast", { email: "district@pacific-coast.demo", name: "Dana District", role: "district", unit: `path @> (select path from org_units where ${store}) and level_key = 'district'` });
  await add("pacific-coast", { email: "store@pacific-coast.demo", name: "Sam Store", role: "store_manager", unit: store });
  await add("pacific-coast", { email: "rep@pacific-coast.demo", name: "Riley Rep", role: "rep", unit: store, person: "top-rep" });
  // Sunrise Wireless (4 stores, no regions or areas).
  await add("sunrise", { email: "admin@sunrise.demo", name: "Alex Admin", role: "dealer_admin", unit: "level_key = 'dealer'" });
  await add("sunrise", { email: "district@sunrise.demo", name: "Drew District", role: "district", unit: "level_key = 'district'" });
  await add("sunrise", { email: "rep@sunrise.demo", name: "Robin Rep", role: "rep", unit: "id = (select org_unit_id from stores where store_number = '101')", person: "top-rep" });

  console.log("Demo logins (password = DEMO_PASSWORD):");
  for (const [e, r] of rows) console.log(`  ${e.padEnd(32)} ${r}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
