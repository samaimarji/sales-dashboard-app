import { NextResponse } from "next/server";
import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { KPI_BY_CODE } from "@/lib/kpis/catalog";

const LEVELS = ["region", "area", "district", "store", "rep"];

/**
 * Saves a report built from the KPI checklist. Until logins exist (step 5) reports are
 * shared by everyone at the dealer; after that they'll belong to the person who saved them.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const dealer = await getDealer((await params).slug);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  const level = String(body.level ?? "");
  const kpis: string[] = Array.isArray(body.kpis) ? body.kpis.filter((k: unknown) => typeof k === "string" && KPI_BY_CODE[k as string]) : [];
  if (!name) return NextResponse.json({ error: "Give the report a name." }, { status: 400 });
  if (!LEVELS.includes(level)) return NextResponse.json({ error: "Invalid row level." }, { status: 400 });
  if (!kpis.length || kpis.length > 40) return NextResponse.json({ error: "Choose between 1 and 40 KPIs." }, { status: 400 });

  const id = await withDealer(dealer.id, async (sql) => {
    const [r] = await sql<{ id: number }[]>`
      insert into saved_reports (dealer_id, owner_user_id, name, row_level, is_official)
      values (${dealer.id}, null, ${name}, ${level}, false) returning id`;
    await sql`insert into saved_report_kpis ${sql(kpis.map((k, i) => ({ report_id: r.id, kpi_code: k, position: i })))}`;
    await sql`insert into audit_log (dealer_id, action, entity, entity_id, details)
              values (${dealer.id}, 'report.saved', 'saved_report', ${String(r.id)}, ${sql.json({ name, level, kpis })})`;
    return r.id;
  });
  return NextResponse.json({ id });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const dealer = await getDealer((await params).slug);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  const ok = await withDealer(dealer.id, async (sql) => {
    // Official dealer reports can't be deleted here.
    const r = await sql`delete from saved_reports where id = ${id} and not is_official returning id`;
    if (r.length) {
      await sql`insert into audit_log (dealer_id, action, entity, entity_id, details)
                values (${dealer.id}, 'report.deleted', 'saved_report', ${String(id)}, '{}'::jsonb)`;
    }
    return r.length > 0;
  });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Report not found." }, { status: 404 });
}
