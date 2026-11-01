"use client";

import { useActionState } from "react";
import { changePassword, login, type FormState } from "@/lib/auth/actions";

const input = "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">Email<input name="email" type="email" autoComplete="username" required className={input} /></label>
      <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className={input} /></label>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm">Current password<input name="current" type="password" autoComplete="current-password" required className={input} /></label>
      <label className="block text-sm">New password<input name="new" type="password" autoComplete="new-password" required className={input} /></label>
      <label className="block text-sm">New password again<input name="confirm" type="password" autoComplete="new-password" required className={input} /></label>
      <p className="text-xs text-gray-500">At least 10 characters, mixing letters with numbers or symbols.</p>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Change password</button>
    </form>
  );
}
