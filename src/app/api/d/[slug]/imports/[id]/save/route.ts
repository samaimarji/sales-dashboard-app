import { NextResponse } from "next/server";
import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { queueImportSave } from "@/lib/jobs";

/** "Save anyway": saves an import that stopped for review. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const dealer = await getDealer(slug);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
  const ok = await withDealer(dealer.id, async (sql) => {
    const r = await sql`update import_batches set status = 'saving', progress = 65
                         where id = ${Number(id)} and status = 'needs_review' returning id`;
    if (r.length) {
      await sql`insert into audit_log (dealer_id, action, entity, entity_id, details)
                values (${dealer.id}, 'import.saved_despite_mismatches', 'import_batch', ${id}, '{}'::jsonb)`;
    }
    return r.length > 0;
  });
  if (!ok) return NextResponse.json({ error: "This import isn't waiting for review." }, { status: 409 });
  await queueImportSave(Number(id));
  return NextResponse.json({ ok: true });
}
