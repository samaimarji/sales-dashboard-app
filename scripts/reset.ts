/**
 * Wipes the local database so migrations and sample data can be rebuilt from scratch.
 * Refuses to run against anything but localhost.
 *
 *   npm run db:reset   (reset + migrate + seed)
 */
import postgres from "postgres";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Reset only runs against a local database.");

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  await sql.unsafe(`drop schema public cascade; create schema public; grant all on schema public to public;`);
  console.log("Local database wiped.");
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
