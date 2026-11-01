/**
 * Creates the first platform admin login (you can then add dealer admins in the app).
 * Asks for the email, name and password; nothing is saved in any file.
 *
 *   npm run create-admin
 */
import { createInterface } from "node:readline";
import postgres from "postgres";
import { hashPassword, passwordProblem } from "../src/lib/auth/password";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set (see .env.example)");

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Don't echo the password while it's typed.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
  }
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); }));
}

async function main() {
  const email = (await ask("Email: ")).toLowerCase();
  const name = await ask("Full name: ");
  const password = await ask("Password (hidden): ", true);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if ((await ask("Password again (hidden): ", true)) !== password) throw new Error("Passwords don't match.");
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  await sql`insert into users (email, full_name, password_hash, is_platform_admin) values (${email}, ${name}, ${await hashPassword(password)}, true)`;
  console.log(`Platform admin ${email} created. Log in, open a dealer, then add its users under Settings › Users & logins.`);
  await sql.end();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
