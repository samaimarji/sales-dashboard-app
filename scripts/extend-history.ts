/**
 * Speed-test helper: makes the sample data look like a dealer with a year of history by
 * copying the generated months further back in time (Aug–Oct copied 3, 6 and 9 months
 * earlier). Demo dealers only; the copied days aren't meant to be read as real trends.
 *
 *   npm run db:extend-history -- --dealer pacific-coast
 */
import postgres from "postgres";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
const args = process.argv.slice(2);
const slug = args[args.indexOf("--dealer") + 1] ?? "pacific-coast";
const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const [dealer] = await sql<{ id: number; settings: { demo?: boolean } }[]>`select id, settings from dealers where slug = ${slug}`;
  if (!dealer?.settings?.demo) throw new Error("Only demo dealers can be extended.");
  const [{ first }] = await sql<{ first: Date }[]>`select min(biz_date) as first from store_daily_mtd where dealer_id = ${dealer.id}`;
  const from = new Date(first);
  from.setUTCMonth(from.getUTCMonth() - 9);
  await sql`select ensure_month_partitions(${from.toISOString().slice(0, 10)}::date, ${first}::date)`;
  const src = { from: first.toISOString().slice(0, 10), to: new Date(first.getTime() + 91 * 86400_000).toISOString().slice(0, 10) };
  for (const months of [3, 6, 9]) {
    const t0 = Date.now();
    for (const table of ["rep_daily_mtd", "store_daily_mtd", "org_rollup_daily"]) {
      const cols = table === "rep_daily_mtd" ? "dealer_id, store_id, person_id, m, import_batch_id"
        : table === "store_daily_mtd" ? "dealer_id, store_id, m, import_batch_id" : "dealer_id, org_unit_id, store_count, m";
      await sql.unsafe(`
        insert into ${table} (biz_date, ${cols})
        select (biz_date - interval '${months} months')::date, ${cols} from ${table}
         where dealer_id = $1 and biz_date >= $2 and biz_date < $3
        on conflict do nothing`, [dealer.id, src.from, src.to]);
    }
    console.log(`  copied ${months} months back in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const [{ n, days }] = await sql<{ n: number; days: number }[]>`
    select count(*)::int as n, count(distinct biz_date)::int as days from rep_daily_mtd where dealer_id = ${dealer.id}`;
  console.log(`${slug}: ${n.toLocaleString()} rep rows over ${days} days`);
  await sql`analyze`;
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
