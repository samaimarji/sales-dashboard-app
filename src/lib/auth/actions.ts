"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminSql } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { currentUser, endAllSessions, endSession, startSession } from "./session";

const MAX_FAILS = 8;
const LOCK_MINUTES = 15;

export interface FormState { error?: string; ok?: string }

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!email || !password) return { error: "Enter your email and password." };

  const [{ fails }] = await adminSql<{ fails: number }[]>`
    select count(*)::int as fails from login_attempts
     where lower(email) = ${email} and not succeeded and at > now() - make_interval(mins => ${LOCK_MINUTES})`;
  if (fails >= MAX_FAILS) return { error: `Too many tries. Wait ${LOCK_MINUTES} minutes and try again.` };

  const [user] = await adminSql<{ id: number; password_hash: string | null; dealer_id: number | null }[]>`
    select id, password_hash, dealer_id from users where lower(email) = ${email} and active`;
  const ok = !!user && (await verifyPassword(password, user.password_hash));
  await adminSql`insert into login_attempts (email, ip, succeeded) values (${email}, ${ip}, ${ok})`;
  if (!ok) return { error: "That email and password don't match." };

  await startSession(user.id);
  await adminSql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
                 values (${user.dealer_id}, ${user.id}, 'user.login', 'user', ${String(user.id)}, ${adminSql.json({ ip })})`;
  // Only same-site paths are allowed as "next".
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("new") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { error: "The two new passwords don't match." };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  const [row] = await adminSql<{ password_hash: string | null }[]>`select password_hash from users where id = ${user.id}`;
  if (!(await verifyPassword(current, row?.password_hash ?? null))) return { error: "Your current password isn't right." };
  await adminSql`update users set password_hash = ${await hashPassword(next)}, must_change_password = false where id = ${user.id}`;
  await endAllSessions(user.id, true);
  await adminSql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
                 values (${user.dealer_id}, ${user.id}, 'user.password_changed', 'user', ${String(user.id)}, '{}'::jsonb)`;
  if (user.must_change_password) redirect("/");
  return { ok: "Password changed. You've been logged out everywhere else." };
}
