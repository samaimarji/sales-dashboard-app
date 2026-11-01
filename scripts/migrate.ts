/**
 * Applies any SQL files in db/migrations that haven't run yet, in name order,
 * then syncs the KPI catalog table from src/lib/kpis/catalog.ts.
 *
 *   npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { KPI_CATALOG } from "../src/lib/kpis/catalog";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");
const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const dir = join(process.cwd(), "db/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    process.stdout.write(`Applying ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log("done");
  }

  await sql.begin(async (tx) => {
    for (const [i, k] of KPI_CATALOG.entries()) {
      await tx`
        insert into kpi_catalog (code, label, category, unit, agg, numerator, denominator, weight_kpi,
                                 higher_is_better, stored, sources, sort, description)
        values (${k.code}, ${k.label}, ${k.category}, ${k.unit}, ${k.agg}, ${k.numerator ?? null},
                ${k.denominator ?? null}, ${k.weightKpi ?? null}, ${k.higherIsBetter}, ${k.stored},
                ${tx.json(k.sources as unknown as postgres.JSONValue)}, ${i}, ${k.description ?? null})
        on conflict (code) do update set
          label = excluded.label, category = excluded.category, unit = excluded.unit, agg = excluded.agg,
          numerator = excluded.numerator, denominator = excluded.denominator, weight_kpi = excluded.weight_kpi,
          higher_is_better = excluded.higher_is_better, stored = excluded.stored, sources = excluded.sources,
          sort = excluded.sort, description = excluded.description`;
    }
  });
  // Hosted: the app role gets the password from APP_DB_PASSWORD (never the development default).
  if (process.env.APP_DB_PASSWORD) {
    await sql.unsafe(`alter role dd_app password '${process.env.APP_DB_PASSWORD.replace(/'/g, "''")}'`);
    console.log("App database role password set.");
  }
  const codes = KPI_CATALOG.map((k) => k.code);
  const removed = await sql`delete from kpi_catalog where code <> all(${codes}) returning code`;
  if (removed.length) console.log(`Removed KPIs no longer in the catalog: ${removed.map((r) => r.code).join(", ")}`);
  console.log(`KPI catalog synced (${KPI_CATALOG.length} KPIs).`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
