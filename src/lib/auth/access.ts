import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import type postgres from "postgres";
import { cache } from "react";
import { adminSql } from "@/lib/db";
import { getDealer, type Dealer } from "@/lib/dealers";
import { currentUser, type SessionUser } from "./session";

export type Role = "dealer_admin" | "region" | "area" | "district" | "store_manager" | "rep";

export const ROLE_LABEL: Record<Role, string> = {
  dealer_admin: "Dealer admin", region: "Region manager", area: "Area manager", district: "District manager",
  store_manager: "Store manager", rep: "Rep",
};

export interface Access {
  user: SessionUser;
  dealer: Dealer;
  /** dealer admin of this dealer, or a platform admin */
  isAdmin: boolean;
  /** only a rep role: sees nothing but their own card */
  isRepOnly: boolean;
  roles: { role: Role; org_unit_id: number; path: string; level_key: string; name: string }[];
  /** org tree paths this user may see (each with everything under it) */
  roots: string[];
  /** where to send this user when they open the app */
  home: string;
}

/**
 * Who is logged in and what part of this dealer they may see. Every page, API route
 * and settings action goes through this. Row-level security separately keeps dealers apart.
 */
export const getAccess = cache(async (slug: string): Promise<Access | "login" | "forbidden" | "missing"> => {
  const user = await currentUser();
  if (!user) return "login";
  const dealer = await getDealer(slug);
  if (!dealer) return "missing";
  if (!user.is_platform_admin && user.dealer_id !== dealer.id) return "forbidden";

  const roles = await adminSql<Access["roles"]>`
    select r.role, r.org_unit_id, u.path::text, u.level_key, u.name
      from user_roles r join org_units u on u.id = r.org_unit_id
     where r.user_id = ${user.id} and r.dealer_id = ${dealer.id}
     order by nlevel(u.path)`;
  const [root] = await adminSql<{ id: number; path: string }[]>`
    select id, path::text from org_units where dealer_id = ${dealer.id} and level_key = 'dealer'`;
  const isAdmin = user.is_platform_admin || roles.some((r) => r.role === "dealer_admin");
  if (!isAdmin && !roles.length) return "forbidden";
  const isRepOnly = !isAdmin && roles.every((r) => r.role === "rep");
  const roots = isAdmin ? [root.path] : isRepOnly ? [] : roles.filter((r) => r.role !== "rep").map((r) => r.path);

  const top = roles.find((r) => r.role !== "rep");
  const home = isAdmin ? `/d/${slug}`
    : isRepOnly ? (user.person_id ? `/d/${slug}/rep/${user.person_id}` : "/account")
    : top!.level_key === "store" ? `/d/${slug}/store/${top!.org_unit_id}` : `/d/${slug}?unit=${top!.org_unit_id}`;
  return { user, dealer, isAdmin, isRepOnly, roles, roots, home };
});

/** For pages: sends people to log in, or away, when they can't be here. */
export async function requireAccess(slug: string, opts: { admin?: boolean; allowRep?: boolean } = {}): Promise<Access> {
  const a = await getAccess(slug);
  if (a === "login") redirect("/login");
  if (a === "missing") notFound();
  if (a === "forbidden") redirect("/no-access");
  if (a.user.must_change_password) redirect("/account?first=1");
  if (a.isRepOnly && !opts.allowRep) redirect(a.home);
  if (opts.admin && !a.isAdmin) redirect(a.home);
  return a;
}

/** For API routes: the same checks, answered with 401/403 instead of redirects. */
export async function apiAccess(slug: string, opts: { admin?: boolean } = {}): Promise<Access | NextResponse> {
  const a = await getAccess(slug);
  if (a === "login") return NextResponse.json({ error: "Please log in." }, { status: 401 });
  if (a === "missing") return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
  if (a === "forbidden" || a.isRepOnly || (opts.admin && !a.isAdmin)) {
    return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
  }
  return a;
}

/** Is this org unit (by ltree path) inside what the user may see? */
export const inScope = (a: Access, path: string) => a.roots.some((r) => path === r || path.startsWith(r + "."));

/** May this user see this person's rep card? */
export async function canSeePerson(sql: postgres.TransactionSql, a: Access, personId: number): Promise<boolean> {
  if (a.isAdmin) return true;
  if (a.user.person_id === personId) return true;
  if (!a.roots.length) return false;
  const [r] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from store_assignments s join org_units u on u.id = s.store_id
       where s.person_id = ${personId} and u.path <@ any(${a.roots}::ltree[])
    ) as ok`;
  return r.ok;
}
