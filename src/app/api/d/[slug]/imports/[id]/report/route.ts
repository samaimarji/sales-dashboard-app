import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";

const CHECK_LABELS: Record<string, string> = {
  matrix_vs_mtd: "Rep totals vs MTD (Detailed Matrix)", rank_vs_mtd: "Rank export vs MTD", chi_vs_mtd: "CHI file vs MTD",
  features_vs_mtd: "Features file vs MTD", files: "Files", date: "Date", new_records: "New stores / reps",
};

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Issue report for one import, as a spreadsheet (CSV opens in Excel and Google Sheets). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const dealer = await getDealer(slug);
  if (!dealer) return new Response("Dealer not found", { status: 404 });
  const data = await withDealer(dealer.id, async (sql) => {
    const [batch] = await sql<{ id: number; biz_date: Date }[]>`select id, biz_date from import_batches where id = ${Number(id)}`;
    if (!batch) return null;
    const rows = await sql<{
      severity: string; check_name: string; store_number: string | null; kpi_code: string | null;
      expected: string | null; actual: string | null; message: string; store_name: string | null; district: string | null; held: string | null;
    }[]>`
      select i.severity, i.check_name, i.store_number, i.kpi_code, i.expected, i.actual, i.message,
             u.name as store_name, d.name as district, h.status as held
        from reconciliation_issues i
        left join stores s on s.store_number = i.store_number
        left join org_units u on u.id = s.org_unit_id
        left join org_units d on d.id = u.parent_id
        left join import_held_stores h on h.batch_id = i.batch_id and h.store_id = s.org_unit_id
       where i.batch_id = ${batch.id}
       order by case i.severity when 'error' then 0 when 'warning' then 1 else 2 end,
                nullif(regexp_replace(coalesce(i.store_number, ''), '\\D', '', 'g'), '')::int nulls last, i.id`;
    return { batch, rows };
  });
  if (!data) return new Response("Import not found", { status: 404 });

  const date = data.batch.biz_date.toISOString().slice(0, 10);
  const lines = [
    ["Severity", "Store #", "Store", "District", "Store status", "Check", "KPI", "MTD value", "Other file value", "Difference", "Details"].join(","),
    ...data.rows.map((r) => {
      const exp = r.expected === null ? null : Number(r.expected);
      const act = r.actual === null ? null : Number(r.actual);
      return [
        r.severity === "error" ? "Problem" : r.severity === "warning" ? "Warning" : "Note",
        r.store_number, r.store_name, r.district,
        r.held === "held" ? "Held" : r.held === "released" ? "Saved anyway" : "",
        CHECK_LABELS[r.check_name] ?? r.check_name, r.kpi_code ? KPI_BY_CODE[r.kpi_code]?.label ?? r.kpi_code : "",
        exp, act, exp !== null && act !== null ? Math.round((act - exp) * 100) / 100 : null, r.message,
      ].map(csv).join(",");
    }),
  ];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-import-${data.batch.id}-${date}-issues.csv"`,
    },
  });
}
