import Link from "next/link";
import { Pager } from "@/components/ui";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";
import { withParams } from "@/lib/links";
import { setHidden } from "../actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type Search = { q?: string; show?: string; page?: string; done?: string };

/** Everyone in the files: hide people from rep views, find people at several stores, combine duplicates. */
export default async function PeopleSettings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { dealer } = await requireAccess(slug, { admin: true });
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().toLowerCase();
  const show = ["hidden", "multi", "new"].includes(sp.show ?? "") ? sp.show! : "all";

  const rows = await withDealer(dealer.id, async (sql) => {
    const filter = show === "hidden" ? sql`and p.hidden_from_rep_views`
      : show === "multi" ? sql`and (select count(*) from store_assignments a where a.person_id = p.id) > 1`
      : show === "new" ? sql`and p.auto_added` : sql``;
    const search = q ? sql`and (lower(p.display_name) like ${"%" + q + "%"} or lower(p.employee_code) like ${"%" + q + "%"})` : sql``;
    return sql<{ id: number; display_name: string; employee_code: string | null; hidden_from_rep_views: boolean; auto_added: boolean; stores: string | null; spellings: number; total: number }[]>`
      select p.id, p.display_name, p.employee_code, p.hidden_from_rep_views, p.auto_added,
             (select string_agg(u.code, ' + ' order by u.code) from store_assignments a join org_units u on u.id = a.store_id where a.person_id = p.id) as stores,
             (select count(*)::int from person_aliases a where a.person_id = p.id) as spellings,
             count(*) over ()::int as total
        from people p
       where p.merged_into_id is null ${filter} ${search}
       order by p.hidden_from_rep_views desc, p.display_name
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  });
  const total = rows[0]?.total ?? 0;
  const here = (o: Search) => withParams(`/d/${slug}/settings/people`, { q: sp.q, show: show === "all" ? undefined : show, ...o });

  return (
    <div>
      <p className="text-sm text-gray-600">
        <b>Hide from rep views:</b> a hidden person&apos;s sales still count in every store and company total, but their name never shows
        in rep lists, rankings or rep cards. <b>Combine:</b> if one person shows up twice (two IDs or spellings), tick both and combine them.
        People at more than one store are already combined automatically by employee ID.
      </p>
      {sp.done === "combined" && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Combined. Their history now shows under one name.</p>}

      <form className="mt-4 flex flex-wrap items-center gap-2" action={`/d/${slug}/settings/people`}>
        <input name="q" defaultValue={sp.q} placeholder="Name or employee ID" className="w-64 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm" />
        <select name="show" defaultValue={show} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
          <option value="all">Everyone</option>
          <option value="hidden">Hidden from rep views</option>
          <option value="multi">At more than one store</option>
          <option value="new">Added by imports</option>
        </select>
        <button className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>Find</button>
      </form>

      {/* Ticked rows go to the "combine" screen. */}
      <form id="combine" action={`/d/${slug}/settings/people/combine`} />
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2"></th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Employee ID</th>
              <th className="px-3 py-2">Stores</th><th className="px-3 py-2">In rep views</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-3 py-2"><input type="checkbox" name="ids" value={p.id} form="combine" aria-label={`Select ${p.display_name}`} /></td>
                <td className="px-3 py-2 font-medium">
                  {p.hidden_from_rep_views ? p.display_name : <Link href={`/d/${slug}/rep/${p.id}`} className="hover:underline">{p.display_name}</Link>}
                  {p.auto_added && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">new</span>}
                  {p.spellings > 1 && <span className="ml-2 text-xs text-gray-400">{p.spellings} spellings</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{p.employee_code ?? "–"}</td>
                <td className="px-3 py-2 text-gray-600">{p.stores ?? "–"}</td>
                <td className="px-3 py-2">
                  <form action={setHidden} className="flex items-center gap-2">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="personId" value={p.id} />
                    <input type="hidden" name="hidden" value={String(!p.hidden_from_rep_views)} />
                    {p.hidden_from_rep_views
                      ? <><span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-white">Hidden</span><button className="text-xs text-gray-500 hover:underline">Show again</button></>
                      : <><span className="text-xs text-green-700">Shown</span><button className="text-xs text-gray-500 hover:underline">Hide</button></>}
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No one found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button form="combine" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50">Combine ticked people…</button>
        <span className="text-xs text-gray-500">Tick 2 or more rows first. You&apos;ll confirm on the next screen.</span>
      </div>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} noun="people" href={(p) => here({ page: String(p) })} />
    </div>
  );
}
