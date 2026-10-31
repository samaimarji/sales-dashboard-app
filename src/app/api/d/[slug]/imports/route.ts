import { NextResponse } from "next/server";
import { withDealer } from "@/lib/db";
import { getDealer } from "@/lib/dealers";
import { queueImportCheck } from "@/lib/jobs";
import { putFile } from "@/lib/storage";

const MAX_FILES = 20;
const MAX_BYTES = 50 * 1024 * 1024;

/** Receives the day's files, stores them and queues the background check. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const dealer = await getDealer((await params).slug);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const chosenDate = String(form.get("date") ?? "");
  if (!files.length) return NextResponse.json({ error: "Add at least one file." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Up to ${MAX_FILES} files at a time.` }, { status: 400 });
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) return NextResponse.json({ error: `${tooBig.name} is larger than 50 MB.` }, { status: 400 });
  if (chosenDate && !/^\d{4}-\d{2}-\d{2}$/.test(chosenDate)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const batchId = await withDealer(dealer.id, async (sql) => {
    const [b] = await sql<{ id: number }[]>`
      insert into import_batches (dealer_id, biz_date, status, progress, source, summary)
      values (${dealer.id}, ${chosenDate || new Date().toISOString().slice(0, 10)}, 'queued', 0, 'upload',
              ${sql.json({ chosen_date: chosenDate || null, file_count: files.length })})
      returning id`;
    for (const [i, f] of files.entries()) {
      const safeName = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
      const key = await putFile(`batches/${b.id}/${i + 1}-${safeName}`, Buffer.from(await f.arrayBuffer()));
      await sql`insert into import_files (batch_id, dealer_id, original_name, storage_key)
                values (${b.id}, ${dealer.id}, ${f.name}, ${key})`;
    }
    await sql`insert into audit_log (dealer_id, action, entity, entity_id, details)
              values (${dealer.id}, 'import.uploaded', 'import_batch', ${String(b.id)},
                      ${sql.json({ files: files.map((f) => f.name), chosen_date: chosenDate || null })})`;
    return b.id;
  });
  await queueImportCheck(batchId);
  return NextResponse.json({ id: batchId });
}
