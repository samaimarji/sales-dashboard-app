import { AddUserForm, ResetPasswordForm } from "@/components/UserForms";
import { requireAccess, ROLE_LABEL, type Role } from "@/lib/auth/access";
import { adminSql, withDealer } from "@/lib/db";
import { setActive } from "./actions";

export const dynamic = "force-dynamic";

/** Logins for this dealer and what part of the company each one sees. */
export default async function UserSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await requireAccess(slug, { admin: true });
  const { dealer } = access;
  const users = await adminSql<{ id: number; full_name: string; email: string; active: boolean; last_login_at: Date | null; must_change_password: boolean; roles: { role: Role; unit: string }[] | null }[]>`
    select u.id, u.full_name, u.email, u.active, u.last_login_at, u.must_change_password,
           (select jsonb_agg(jsonb_build_object('role', r.role, 'unit', coalesce(o.code || ' · ', '') || o.name))
              from user_roles r join org_units o on o.id = r.org_unit_id where r.user_id = u.id) as roles
      from users u where u.dealer_id = ${dealer.id}
     order by u.active desc, u.full_name`;
  const { levels, units } = await withDealer(dealer.id, async (sql) => {
    const levels = await sql<{ level_key: string; label: string; enabled: boolean }[]>`select level_key, label, enabled from dealer_org_levels order by depth`;
    const rows = await sql<{ level_key: string; label: string }[]>`
      select level_key, coalesce(code || ' · ', '') || name as label from org_units where level_key <> 'dealer' order by level_key, code, name`;
    const units: Record<string, string[]> = {};
    for (const r of rows) (units[r.level_key] ??= []).push(r.label);
    return { levels, units };
  });
  const label = Object.fromEntries(levels.map((l) => [l.level_key, l.label]));
  const enabled = new Set(levels.filter((l) => l.enabled).map((l) => l.level_key));
  const roles = (Object.keys(ROLE_LABEL) as Role[])
    .filter((r) => !["region", "area", "district"].includes(r) || enabled.has(r))
    .map((r) => {
      const level = r === "dealer_admin" ? "dealer" : r === "store_manager" ? "store" : r === "rep" ? null : r;
      const text = r === "dealer_admin" || r === "rep" || r === "store_manager" ? ROLE_LABEL[r] : `${label[r]} manager`;
      return { value: r, label: text, level };
    });

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Each login sees only its part of the company: a district manager sees their district, a store manager their store, a rep only
        their own card. Only dealer admins can upload files and change settings.
      </p>
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-semibold">Add a login</h2>
        <AddUserForm slug={slug} roles={roles} units={units} color={dealer.primary_color} />
      </section>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Last login</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-gray-100 ${u.active ? "" : "text-gray-400"}`}>
                <td className="px-3 py-2"><span className="font-medium">{u.full_name}</span><span className="block text-xs text-gray-500">{u.email}</span></td>
                <td className="px-3 py-2">
                  {(u.roles ?? []).map((r, i) => (
                    <div key={i}>{r.role === "rep" ? "Rep" : r.role === "dealer_admin" ? "Dealer admin" : r.role === "store_manager" ? "Store manager" : `${label[r.role]} manager`}
                      {r.role !== "dealer_admin" && <span className="text-gray-500"> · {r.unit}</span>}</div>
                  ))}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {u.last_login_at ? u.last_login_at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }) : "Never"}
                  {u.must_change_password && <span className="block text-xs text-amber-700">Still on temporary password</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <ResetPasswordForm slug={slug} userId={u.id} />
                    {u.id !== access.user.id && (
                      <form action={setActive}>
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                        <button className="text-xs text-gray-500 hover:underline">{u.active ? "Turn off login" : "Turn login back on"}</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
