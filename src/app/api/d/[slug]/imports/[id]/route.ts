import { NextResponse } from "next/server";
import { withDealer } from "@/lib/db";
import { apiAccess } from "@/lib/auth/access";

/** Status for the progress page (polled every second while an import runs). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const access = await apiAccess(slug, { admin: true });
  if (access instanceof Response) return access;
  const { dealer } = access;
  const url = new URL(req.url);
  const severity = url.searchParams.get("severity");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const PAGE = 100;

  const data = await withDealer(dealer.id, async (sql) => {
    const [batch] = await sql`
      select id, biz_date, status, progress, summary, error, date_source, created_at, finished_at
        from import_batches where id = ${Number(id)}`;
    if (!batch) return null;
    const files = await sql`
      select id, original_name, file_type, row_count, detected_date, status, message
        from import_files where batch_id = ${batch.id} order by id`;
    const filter = severity ? sql`and severity = ${severity}` : sql``;
    const [{ total }] = await sql<{ total: number }[]>`
      select count(*)::int as total from reconciliation_issues where batch_id = ${batch.id} ${filter}`;
    const issues = await sql`
      select severity, check_name, kpi_code, expected, actual, message from reconciliation_issues
       where batch_id = ${batch.id} ${filter}
       order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, id
       limit ${PAGE} offset ${(page - 1) * PAGE}`;
    // Held stores with their problems, 50 per page.
    const heldPage = Math.max(1, Number(url.searchParams.get("heldPage")) || 1);
    const [{ heldTotal, stillHeld }] = await sql<{ heldTotal: number; stillHeld: number }[]>`
      select count(*)::int as "heldTotal", count(*) filter (where status = 'held')::int as "stillHeld"
        from import_held_stores where batch_id = ${batch.id}`;
    const held = await sql<{ store_number: string; status: string; carried_from: Date | null; store_name: string; district: string | null; problems: string[] }[]>`
      select h.store_number, h.status, h.carried_from, u.name as store_name, d.name as district,
             coalesce((select array_agg(i.message order by i.id) from reconciliation_issues i
                        where i.batch_id = h.batch_id and i.store_number = h.store_number and i.severity = 'error'), '{}') as problems
        from import_held_stores h
        join org_units u on u.id = h.store_id
        left join org_units d on d.id = u.parent_id
       where h.batch_id = ${batch.id}
       order by h.status = 'released', nullif(regexp_replace(h.store_number, '\\D', '', 'g'), '')::int nulls last
       limit 50 offset ${(heldPage - 1) * 50}`;
    return { batch, files, issues, issueTotal: total, page, pageSize: PAGE, held, heldTotal, stillHeld, heldPage };
  });
  if (!data) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  return NextResponse.json(data);
}
