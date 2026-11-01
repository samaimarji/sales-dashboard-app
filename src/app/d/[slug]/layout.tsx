import Link from "next/link";
import { notFound } from "next/navigation";
import { getDealer } from "@/lib/dealers";

export default async function DealerLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dealer = await getDealer(slug);
  if (!dealer) notFound();
  const nav = [
    { href: `/d/${slug}`, label: "Overview" },
    { href: `/d/${slug}/report`, label: "KPI report" },
    { href: `/d/${slug}/rankings`, label: "Rankings" },
    { href: `/d/${slug}/opportunities`, label: "Opportunities" },
    { href: `/d/${slug}/upload`, label: "Upload" },
    { href: `/d/${slug}/imports`, label: "Import history" },
    { href: `/d/${slug}/settings`, label: "Settings" },
  ];
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href={`/d/${slug}`} className="flex items-center gap-2 font-semibold">
            <span className="h-6 w-6 rounded-md" style={{ background: dealer.primary_color }} />
            {dealer.name}
          </Link>
          <nav className="flex gap-4 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="text-gray-600 hover:text-gray-900">{n.label}</Link>)}
          </nav>
          <Link href="/" className="ml-auto text-xs text-gray-400 hover:underline">All dealers</Link>
        </div>
      </header>
      {children}
    </div>
  );
}
