"use client";

import { useActionState, useState } from "react";
import { addUser, resetPassword, type UserFormState } from "@/app/d/[slug]/settings/users/actions";

const input = "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm";

export function AddUserForm({ slug, roles, units, color }: {
  slug: string; color: string;
  roles: { value: string; label: string; level: string | null }[];
  units: Record<string, string[]>;
}) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(addUser, {});
  const [role, setRole] = useState(roles[0].value);
  const level = roles.find((r) => r.value === role)?.level;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="slug" value={slug} />
      <label className="text-sm">Full name<input name="full_name" required className={input} /></label>
      <label className="text-sm">Email<input name="email" type="email" required className={input} /></label>
      <label className="text-sm">Role
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={input}>
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      {role === "rep" ? (
        <label className="text-sm">Their employee ID (as in Power BI)<input name="employee_id" required className={input} placeholder="e.g. ab1234" /></label>
      ) : level && level !== "dealer" ? (
        <label className="text-sm">Which {level}?
          <input name="where" list={`units-${level}`} required className={input} placeholder="Start typing a name or number" />
          <datalist id={`units-${level}`}>{(units[level] ?? []).map((u) => <option key={u} value={u} />)}</datalist>
        </label>
      ) : <div className="self-end pb-2 text-sm text-gray-500">Sees the whole company, uploads files and changes settings.</div>}
      <label className="text-sm">Temporary password<input name="password" type="text" required autoComplete="off" className={input} /></label>
      <div className="self-end text-xs text-gray-500">They&apos;ll be asked to choose their own the first time they log in.</div>
      <div className="sm:col-span-2">
        <button disabled={pending} className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ background: color }}>Add login</button>
        {state.error && <span className="ml-3 text-sm text-red-600">{state.error}</span>}
        {state.ok && <span className="ml-3 text-sm text-green-700">{state.ok}</span>}
      </div>
    </form>
  );
}

export function ResetPasswordForm({ slug, userId }: { slug: string; userId: number }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(resetPassword, {});
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-gray-500 hover:underline">Reset password</button>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="userId" value={userId} />
      <input name="password" placeholder="New temporary password" autoComplete="off" className="w-44 rounded border border-gray-300 px-2 py-0.5 text-xs" />
      <button disabled={pending} className="text-xs font-medium hover:underline">Set</button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state.ok && <span className="text-xs text-green-700">{state.ok}</span>}
    </form>
  );
}
