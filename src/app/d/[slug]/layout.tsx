import Link from "next/link";
import { requireAccess, ROLE_LABEL } from "@/lib/auth/access";
import { logout } from "@/lib/auth/actions";

export default async function DealerLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await requireAccess(slug, { allowRep: true });
  const { dealer } = access;
  const all = [
    { href: `/d/${slug}`, label: "Overview" },
    { href: `/d/${slug}/report`, label: "KPI report" },
    { href: `/d/${slug}/rankings`, label: "Rankings" },
    { href: `/d/${slug}/opportunities`, label: "Opportunities" },
    { href: `/d/${slug}/upload`, label: "Upload" },
    { href: `/d/${slug}/imports`, label: "Import history" },
    { href: `/d/${slug}/settings`, label: "Settings" },
  ];
  // Reps only get their own card; uploads and settings are for dealer admins.
  const nav = access.isRepOnly ? [{ href: access.home, label: "My card" }]
    : all.filter((n) => access.isAdmin || !/\/(upload|imports|settings)$/.test(n.href))
         .map((n) => (n.label === "Overview" ? { ...n, href: access.home } : n));
  const roleText = access.user.is_platform_admin ? "Platform admin"
    : access.roles.map((r) => `${ROLE_LABEL[r.role]}${r.role === "dealer_admin" || r.role === "rep" ? "" : ` · ${r.name}`}`).join(", ");
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href={access.home} className="flex items-center gap-2 font-semibold">
            <span className="h-6 w-6 rounded-md" style={{ background: dealer.primary_color }} />
            {dealer.name}
          </Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="text-gray-600 hover:text-gray-900">{n.label}</Link>)}
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <span className="hidden md:inline" title={roleText}>{access.user.full_name} · {roleText}</span>
            {access.user.is_platform_admin && <Link href="/" className="hover:underline">All dealers</Link>}
            <Link href="/account" className="hover:underline">Account</Link>
            <button className="hover:underline">Log out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
