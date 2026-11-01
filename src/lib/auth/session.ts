import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { adminSql } from "@/lib/db";

export const SESSION_COOKIE = "dd_session";
const DAYS = 14;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface SessionUser {
  id: number;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  dealer_id: number | null;
  person_id: number | null;
  must_change_password: boolean;
}

/** Starts a session: a random token in an httpOnly cookie; only its hash is stored. */
export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + DAYS * 86400_000);
  await adminSql`insert into sessions (id, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expires})`;
  await adminSql`update users set last_login_at = now() where id = ${userId}`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/", expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await adminSql`delete from sessions where id = ${hashToken(token)}`;
  jar.delete(SESSION_COOKIE);
}

/** Ends every session for a user (after a password change or when deactivated). */
export async function endAllSessions(userId: number, exceptCurrent = false) {
  const token = exceptCurrent ? (await cookies()).get(SESSION_COOKIE)?.value : undefined;
  await adminSql`delete from sessions where user_id = ${userId} and id <> ${token ? hashToken(token) : ""}`;
}

/** The logged-in user for this request, or null. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [u] = await adminSql<SessionUser[]>`
    select u.id, u.email, u.full_name, u.is_platform_admin, u.dealer_id, u.person_id, u.must_change_password
      from sessions s join users u on u.id = s.user_id
     where s.id = ${hashToken(token)} and s.expires_at > now() and u.active`;
  return u ?? null;
});
