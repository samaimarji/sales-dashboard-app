import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/access";
import { logout } from "@/lib/auth/actions";
import { currentUser } from "@/lib/auth/session";
import { adminSql } from "@/lib/db";
import { formatKpi } from "@/lib/kpis/value";

export const dynamic = "force-dynamic";

interface DealerRow {
  id: number;
  slug: string;
  name: string;
  primary_color: string;
  stores: number;
  people: number;
  hidden: number;
  first_date: Date | null;
  last_date: Date | null;
  activations: string | null;
  levels: string;
}

/**
 * Front door. Platform admins see every dealer; everyone else goes straight to their
 * own home (company overview, district, store card, or their rep card).
 */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/account?first=1");
  if (!user.is_platform_admin) {
    const [d] = await adminSql<{ slug: string }[]>`select slug from dealers where id = ${user.dealer_id}`;
    const a = d ? await getAccess(d.slug) : "forbidden";
    redirect(typeof a === "object" ? a.home : "/no-access");
  }

  const dealers = await adminSql<DealerRow[]>`
    select d.id, d.slug, d.name, d.primary_color,
           (select count(*)::int from stores s where s.dealer_id = d.id) as stores,
           (select count(*)::int from people p where p.dealer_id = d.id) as people,
           (select count(*)::int from people p where p.dealer_id = d.id and p.hidden_from_rep_views) as hidden,
           (select min(biz_date) from import_batches b where b.dealer_id = d.id) as first_date,
           (select max(biz_date) from import_batches b where b.dealer_id = d.id) as last_date,
           (select r.m ->> 'activations' from org_rollup_daily r
              join org_units u on u.id = r.org_unit_id and u.level_key = 'dealer'
             where r.dealer_id = d.id order by r.biz_date desc limit 1) as activations,
           (select string_agg(label, ' › ' order by depth) from dealer_org_levels l
             where l.dealer_id = d.id and l.enabled) as levels
      from dealers d order by d.name`;

  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "–");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Dealer Dashboard</h1>
        <form action={logout} className="text-sm text-gray-500">{user.full_name} · <Link href="/account" className="hover:underline">Account</Link> · <button className="hover:underline">Log out</button></form>
      </div>
      <p className="mt-1 text-sm text-gray-600">Platform admin: every dealer on the system. Sample dealers use made-up names.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {dealers.map((d) => (
          <Link key={d.id} href={`/d/${d.slug}`}
            className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-lg" style={{ background: d.primary_color }} />
              <h2 className="text-lg font-semibold">{d.name}</h2>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-gray-500">Stores</dt><dd className="font-medium">{d.stores.toLocaleString()}</dd>
              <dt className="text-gray-500">People</dt>
              <dd className="font-medium">{d.people.toLocaleString()} <span className="text-gray-500">({d.hidden} hidden)</span></dd>
              <dt className="text-gray-500">Levels</dt><dd className="font-medium">{d.levels}</dd>
              <dt className="text-gray-500">Data</dt><dd className="font-medium">{fmtDate(d.first_date)} – {fmtDate(d.last_date)}</dd>
              <dt className="text-gray-500">Activations MTD</dt>
              <dd className="font-medium">{formatKpi("activations", d.activations ? Number(d.activations) : undefined)}</dd>
            </dl>
            <p className="mt-4 text-sm font-medium" style={{ color: d.primary_color }}>Browse org tree →</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
