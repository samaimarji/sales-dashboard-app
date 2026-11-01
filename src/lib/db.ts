import postgres from "postgres";

/**
 * Two connections:
 *  - `appSql` connects as the restricted dd_app role. Row-level security only lets it
 *    see the dealer set with withDealer(). Use this for everything a dealer user does.
 *  - `adminSql` connects as the owner role. Only for migrations, the sample-data
 *    generator, login lookups and platform-admin screens.
 */

declare global {
  // Reuse connections across hot reloads in development.
  var __ddAppSql: postgres.Sql | undefined;
  var __ddAdminSql: postgres.Sql | undefined;
}

function connect(url: string | undefined, name: string) {
  if (!url) throw new Error(`${name} is not set. Copy .env.example to .env.local.`);
  return postgres(url, { max: 10, idle_timeout: 30 });
}

/**
 * When hosted, only the owner connection is given (DATABASE_ADMIN_URL) plus the app
 * role's password (APP_DB_PASSWORD); the app connection is built from the two.
 */
function appUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const admin = process.env.DATABASE_ADMIN_URL;
  const pw = process.env.APP_DB_PASSWORD;
  if (!admin || !pw) return undefined;
  const u = new URL(admin);
  u.username = "dd_app";
  u.password = pw;
  return u.toString();
}

export const appSql = (globalThis.__ddAppSql ??= connect(appUrl(), "DATABASE_URL (or DATABASE_ADMIN_URL + APP_DB_PASSWORD)"));
export const adminSql = (globalThis.__ddAdminSql ??= connect(process.env.DATABASE_ADMIN_URL, "DATABASE_ADMIN_URL"));

/** Runs `fn` in a transaction where the database only exposes one dealer's rows. */
export async function withDealer<T>(dealerId: number, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const result = await appSql.begin(async (sql) => {
    await sql`select set_config('app.dealer_id', ${String(dealerId)}, true)`;
    return fn(sql);
  });
  return result as T;
}
