import Link from "next/link";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { combinePeople } from "../../actions";

export const dynamic = "force-dynamic";

/** Confirm screen for combining records of the same person. */
export default async function CombinePeople({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const { slug } = await params;
  const raw = (await searchParams).ids;
  const ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter(Boolean))].slice(0, 10);
  const { dealer } = await requireAccess(slug, { admin: true });
  const people = await withDealer(dealer.id, (sql) => sql<{ id: number; display_name: string; employee_code: string | null; hidden_from_rep_views: boolean; stores: string | null; spellings: string[]; days: number }[]>`
    select p.id, p.display_name, p.employee_code, p.hidden_from_rep_views,
           (select string_agg(u.code, ' + ' order by u.code) from store_assignments a join org_units u on u.id = a.store_id where a.person_id = p.id) as stores,
           array(select raw_name from person_aliases a where a.person_id = p.id order by raw_name) as spellings,
           (select count(distinct biz_date)::int from rep_daily_mtd r where r.person_id = p.id) as days
      from people p where p.id = any(${ids}) and p.merged_into_id is null order by p.display_name`);

  if (people.length < 2) {
    return (
      <div className="text-sm">
        <p>Tick at least two people on the People page to combine them.</p>
        <Link href={`/d/${slug}/settings/people`} className="mt-2 inline-block underline">← Back to People</Link>
      </div>
    );
  }
  return (
    <form action={combinePeople} className="max-w-3xl">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="ids" value={people.map((p) => p.id).join(",")} />
      <h2 className="text-lg font-semibold">Combine {people.length} records into one person</h2>
      <p className="mt-1 text-sm text-gray-600">
        Pick the name to keep. All sales history, name spellings and stores move to that person. Store and company totals don&apos;t change.
        {people.some((p) => p.hidden_from_rep_views) && " One of these people is hidden from rep views, so the combined person will be hidden too."}
      </p>
      <div className="mt-4 space-y-2">
        {people.map((p, i) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm has-[:checked]:border-gray-800">
            <input type="radio" name="keep" value={p.id} defaultChecked={i === 0} className="mt-1" />
            <span>
              <span className="font-semibold">{p.display_name}</span> <span className="text-gray-500">· ID {p.employee_code ?? "none"} · stores {p.stores ?? "–"} · {p.days} days of numbers</span>
              <span className="mt-1 block text-xs text-gray-500">Spelled in files as: {p.spellings.join("; ") || "–"}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Combine</button>
        <Link href={`/d/${slug}/settings/people`} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm">Cancel</Link>
      </div>
    </form>
  );
}
