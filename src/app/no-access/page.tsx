import { logout } from "@/lib/auth/actions";

export default function NoAccess() {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-gray-600">Your login isn&apos;t set up for this. Ask your dealer admin to check your role.</p>
      <form action={logout} className="mt-6"><button className="text-sm text-gray-500 hover:underline">Log out</button></form>
    </main>
  );
}
