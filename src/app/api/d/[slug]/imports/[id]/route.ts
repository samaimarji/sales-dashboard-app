import { NextResponse } from "next/server";
import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";

/** Status for the progress page (polled every second while an import runs). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const dealer = await getDealer(slug);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
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
    return { batch, files, issues, issueTotal: total, page, pageSize: PAGE };
  });
  if (!data) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  return NextResponse.json(data);
}
