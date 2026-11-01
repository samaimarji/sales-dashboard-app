import Link from "next/link";

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tabs = [
    ["people", "People"], ["goals", "Store goals"], ["targets", "Rate targets"], ["company", "Company"], ["history", "Change history"],
  ];
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <nav className="mt-3 flex flex-wrap gap-1 border-b border-gray-200 text-sm">
        {tabs.map(([href, label]) => (
          <Link key={href} href={`/d/${slug}/settings/${href}`} className="rounded-t-md px-3 py-2 text-gray-600 hover:bg-white hover:text-gray-900">
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </main>
  );
}
