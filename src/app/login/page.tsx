import { redirect } from "next/navigation";
import { LoginForm } from "@/components/AuthForms";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Dealer Dashboard</h1>
        <p className="mt-1 mb-6 text-sm text-gray-500">Log in to see your numbers.</p>
        <LoginForm next={next ?? "/"} />
        <p className="mt-6 text-xs text-gray-400">Forgot your password? Ask your dealer admin to reset it.</p>
      </div>
    </main>
  );
}
