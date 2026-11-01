"use server";

import { revalidatePath } from "next/cache";
import { requireAccess, type Role } from "@/lib/auth/access";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { endAllSessions } from "@/lib/auth/session";
import { adminSql, withDealer } from "@/lib/db";

export interface UserFormState { error?: string; ok?: string }

const ROLE_LEVEL: Record<Role, string | null> = {
  dealer_admin: "dealer", region: "region", area: "area", district: "district", store_manager: "store", rep: null,
};

async function admin(form: FormData) {
  return requireAccess(String(form.get("slug")), { admin: true });
}

/** Finds the org unit a role applies to: "1852", "District 171", "North Territory"... */
async function findUnit(dealerId: number, level: string, where: string) {
  const text = where.split(" · ")[0].trim().toLowerCase();
  return withDealer(dealerId, async (sql) => {
    const [u] = await sql<{ id: number; name: string }[]>`
      select id, name from org_units where level_key = ${level}
         and (lower(code) = ${text} or lower(name) = ${text} or lower(coalesce(code, '') || ' · ' || name) = ${where.trim().toLowerCase()})
       limit 1`;
    return u ?? null;
  });
}

/**
 * Adds a login. The admin types a temporary password and tells the person; they must
 * choose their own the first time they log in.
 */
export async function addUser(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const access = await admin(form);
  const dealer = access.dealer;
  const fullName = String(form.get("full_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role")) as Role;
  const where = String(form.get("where") ?? "");
  const employeeId = String(form.get("employee_id") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a name and a valid email." };
  if (!(role in ROLE_LEVEL)) return { error: "Pick a role." };
  const problem = passwordProblem(password);
  if (problem) return { error: `Temporary password: ${problem}` };
  const [exists] = await adminSql`select 1 from users where lower(email) = ${email}`;
  if (exists) return { error: "Someone already uses that email." };

  // Where the role applies, and (for reps) which person they are.
  let unitId: number;
  let personId: number | null = null;
  if (role === "rep") {
    const person = await withDealer(dealer.id, async (sql) => (await sql<{ id: number; store_id: number | null }[]>`
      select p.id, (select a.store_id from store_assignments a where a.person_id = p.id order by a.is_primary desc limit 1) as store_id
        from people p where lower(p.employee_code) = ${employeeId} and p.merged_into_id is null`)[0]);
    if (!person) return { error: "No rep found with that employee ID." };
    if (!person.store_id) return { error: "That rep isn't linked to a store yet." };
    personId = person.id;
    unitId = person.store_id;
  } else if (role === "dealer_admin") {
    const [root] = await withDealer(dealer.id, (sql) => sql<{ id: number }[]>`select id from org_units where level_key = 'dealer'`);
    unitId = root.id;
  } else {
    const unit = await findUnit(dealer.id, ROLE_LEVEL[role]!, where);
    if (!unit) return { error: `Couldn't find that ${ROLE_LEVEL[role]}. Pick one from the list.` };
    unitId = unit.id;
  }

  const hash = await hashPassword(password);
  const [user] = await adminSql<{ id: number }[]>`
    insert into users (email, full_name, password_hash, dealer_id, person_id, must_change_password)
    values (${email}, ${fullName}, ${hash}, ${dealer.id}, ${personId}, true) returning id`;
  await withDealer(dealer.id, async (sql) => {
    await sql`insert into user_roles (user_id, dealer_id, role, org_unit_id) values (${user.id}, ${dealer.id}, ${role}, ${unitId})`;
    await sql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
              values (${dealer.id}, ${access.user.id}, 'user.added', 'user', ${String(user.id)}, ${sql.json({ email, role, unitId })})`;
  });
  revalidatePath(`/d/${dealer.slug}/settings/users`);
  return { ok: `Added ${fullName}. Give them their email and temporary password; they'll pick their own when they first log in.` };
}

export async function resetPassword(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const access = await admin(form);
  const userId = Number(form.get("userId"));
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const [u] = await adminSql<{ email: string }[]>`
    update users set password_hash = ${await hashPassword(password)}, must_change_password = true
     where id = ${userId} and dealer_id = ${access.dealer.id} returning email`;
  if (!u) return { error: "User not found." };
  await endAllSessions(userId);
  await adminSql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
                 values (${access.dealer.id}, ${access.user.id}, 'user.password_reset', 'user', ${String(userId)}, ${adminSql.json({ email: u.email })})`;
  return { ok: `Temporary password set for ${u.email}.` };
}

export async function setActive(form: FormData) {
  const access = await admin(form);
  const userId = Number(form.get("userId"));
  const active = form.get("active") === "true";
  if (userId === access.user.id) return; // can't lock yourself out
  const [u] = await adminSql<{ email: string }[]>`
    update users set active = ${active} where id = ${userId} and dealer_id = ${access.dealer.id} returning email`;
  if (!u) return;
  if (!active) await endAllSessions(userId);
  await adminSql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
                 values (${access.dealer.id}, ${access.user.id}, ${active ? "user.reactivated" : "user.deactivated"}, 'user', ${String(userId)}, ${adminSql.json({ email: u.email })})`;
  revalidatePath(`/d/${access.dealer.slug}/settings/users`);
}
