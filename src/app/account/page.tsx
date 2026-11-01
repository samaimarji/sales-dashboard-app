import Link from "next/link";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/AuthForms";
import { logout } from "@/lib/auth/actions";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const first = (await searchParams).first || user.must_change_password;
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      {!first && <Link href="/" className="text-sm text-gray-500 hover:underline">← Back</Link>}
      <h1 className="mt-2 text-2xl font-semibold">Your account</h1>
      <p className="mt-1 text-sm text-gray-600">{user.full_name} · {user.email}</p>
      {first && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Welcome! Please choose your own password to continue.</p>}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6"><ChangePasswordForm /></div>
      <form action={logout} className="mt-4"><button className="text-sm text-gray-500 hover:underline">Log out</button></form>
    </main>
  );
}
