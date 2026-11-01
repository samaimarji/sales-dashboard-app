import Link from "next/link";
import { withDealer } from "@/lib/db";
import { requireAccess } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const STATUS: Record<string, [string, string]> = {
  done: ["Saved", "text-green-700"], needs_review: ["Needs review", "text-amber-600"], failed: ["Failed", "text-red-600"],
  cancelled: ["Cancelled", "text-gray-500"], replaced: ["Replaced", "text-gray-500"], queued: ["Running", "text-blue-600"],
  reading: ["Running", "text-blue-600"], checking: ["Running", "text-blue-600"], saving: ["Running", "text-blue-600"],
};

export default async function ImportHistory({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { dealer } = await requireAccess(slug, { admin: true });
  const { rows, total } = await withDealer(dealer.id, async (sql) => {
    const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from import_batches`;
    const rows = await sql<{ id: number; biz_date: Date; status: string; source: string; created_at: Date; files: number; errors: number; held: number }[]>`
      select b.id, b.biz_date, b.status, b.source, b.created_at,
             (select count(*)::int from import_held_stores h where h.batch_id = b.id and h.status = 'held') as held,
             (select count(*)::int from import_files f where f.batch_id = b.id) as files,
             coalesce((b.summary -> 'issue_counts' ->> 'error')::int, 0) as errors
        from import_batches b order by b.created_at desc, b.id desc
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
    return { rows, total };
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Import history</h1>
        <Link href={`/d/${slug}/upload`} className="rounded-md px-4 py-1.5 text-sm font-medium text-white" style={{ background: dealer.primary_color }}>
          New upload
        </Link>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Numbers through</th><th className="px-3 py-2">Uploaded</th>
              <th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Files</th><th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [label, cls] = STATUS[r.status] ?? [r.status, ""];
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">{r.source === "generator" ? r.id : <Link className="font-medium hover:underline" href={`/d/${slug}/imports/${r.id}`}>{r.id}</Link>}</td>
                  <td className="px-3 py-2">{r.biz_date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</td>
                  <td className="px-3 py-2 text-gray-600">{r.created_at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-3 py-2 text-gray-600">{r.source === "generator" ? "Sample data" : "Upload"}</td>
                  <td className="px-3 py-2 text-right">{r.source === "generator" ? "–" : r.files}</td>
                  <td className={`px-3 py-2 font-medium ${cls}`}>{label}{r.status === "needs_review" && r.errors ? ` (${r.errors})` : ""}
                    {r.status === "done" && r.held > 0 && <span className="ml-1 font-normal text-amber-600">· {r.held} store{r.held === 1 ? "" : "s"} on hold</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
        <span>{total.toLocaleString()} imports · page {page} of {pages}</span>
        <span className="flex gap-3">
          {page > 1 && <Link className="hover:underline" href={`/d/${slug}/imports?page=${page - 1}`}>← Previous</Link>}
          {page < pages && <Link className="hover:underline" href={`/d/${slug}/imports?page=${page + 1}`}>Next →</Link>}
        </span>
      </div>
    </main>
  );
}
