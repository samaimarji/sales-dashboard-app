/**
 * Runs once at every start on the host (safe to repeat):
 *  - ADMIN_EMAIL + ADMIN_PASSWORD set and no such login yet -> creates the platform admin.
 *    (Remove ADMIN_PASSWORD from the host's settings after your first login.)
 *  - SEED_DEMO=1 and no dealers yet -> creates the two made-up demo dealers, and demo
 *    logins if DEMO_PASSWORD is set. Takes ~5 minutes; the site works meanwhile.
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";

const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const run = (script: string) => spawnSync("npx", ["tsx", script], { stdio: "inherit", env: process.env }).status === 0;

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (email && password) {
    const [exists] = await sql`select 1 from users where lower(email) = ${email}`;
    const problem = passwordProblem(password);
    if (exists) console.log(`[bootstrap] Admin ${email} already exists; nothing to do. You can remove ADMIN_PASSWORD now.`);
    else if (problem) console.log(`[bootstrap] ADMIN_PASSWORD not accepted: ${problem}`);
    else {
      await sql`insert into users (email, full_name, password_hash, is_platform_admin)
                values (${email}, ${process.env.ADMIN_NAME ?? "Platform Admin"}, ${await hashPassword(password)}, true)`;
      console.log(`[bootstrap] Created platform admin ${email}.`);
    }
  }
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from dealers`;
  await sql.end();
  if (process.env.SEED_DEMO === "1" && n === 0) {
    console.log("[bootstrap] Creating the demo dealers (about 5 minutes)…");
    if (run("scripts/seed-demo.ts") && process.env.DEMO_PASSWORD) run("scripts/seed-users.ts");
    console.log("[bootstrap] Demo data ready.");
  }
}

main().catch(async (e) => {
  console.error("[bootstrap]", e);
  await sql.end();
});
