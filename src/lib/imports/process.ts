import { adminSql, withDealer } from "@/lib/db";
import { getFile, putFile } from "@/lib/storage";
import { mergeDay } from "./merge";
import { parseFile, type ParsedFile } from "./parse";
import { reconcile, type Issue } from "./reconcile";
import { previewNewRecords, releaseStores, saveDay } from "./save";

const MAX_ISSUES_STORED = 5000;

/**
 * Stores whose numbers don't match are held; the rest are saved. If too many stores
 * fail, a whole file is probably wrong, so the entire day waits for review instead.
 */
const MAX_HELD_SHARE = 0.2;
const MIN_HELD_BEFORE_DAY_HOLD = 5;

interface BatchRow {
  id: number;
  dealer_id: number;
  status: string;
  biz_date: Date;
  summary: Record<string, unknown>;
  uploaded_by: number | null;
}

async function setStatus(dealerId: number, batchId: number, status: string, progress: number, extra: Record<string, unknown> = {}) {
  await withDealer(dealerId, (sql) => sql`
    update import_batches set status = ${status}, progress = ${progress},
           summary = summary || ${sql.json(extra as never)},
           finished_at = case when ${status} in ('done','failed','needs_review','cancelled') then now() else finished_at end
     where id = ${batchId}`);
}

const parsedKey = (batchId: number) => `batches/${batchId}/parsed.json`;

/**
 * Step A: read every file, run the checks. If nothing is wrong, carry straight on
 * and save. If there are mismatches, stop at "needs review" so a person decides.
 */
export async function checkBatch(batchId: number) {
  const [batch] = await adminSql<BatchRow[]>`select id, dealer_id, status, biz_date, summary, uploaded_by from import_batches where id = ${batchId}`;
  if (!batch || batch.status !== "queued") return;
  const dealerId = batch.dealer_id;
  try {
    await setStatus(dealerId, batchId, "reading", 2);
    const files = await withDealer(dealerId, (sql) => sql<{ id: number; original_name: string; storage_key: string }[]>`
      select id, original_name, storage_key from import_files where batch_id = ${batchId} order by id`);

    const parsed: ParsedFile[] = [];
    for (const [i, f] of files.entries()) {
      const p = await parseFile(f.original_name, await getFile(f.storage_key));
      parsed.push(p);
      await withDealer(dealerId, (sql) => sql`
        update import_files set file_type = ${p.type}, row_count = ${p.records.length}, detected_date = ${p.dateThrough},
               status = ${p.type ? "read" : "not_recognized"}, message = ${p.error ?? null}
         where id = ${f.id}`);
      await setStatus(dealerId, batchId, "reading", Math.round(5 + (45 * (i + 1)) / files.length));
    }

    await setStatus(dealerId, batchId, "checking", 55);
    const chosen = batch.summary.chosen_date as string | undefined;
    const result = reconcile(parsed, chosen ?? null);
    const merged = mergeDay(parsed);
    const issues: Issue[] = [...result.issues];
    const preview = await withDealer(dealerId, (sql) => previewNewRecords(sql, dealerId, merged));
    if (preview.newStores.length) {
      issues.push({ severity: "warning", check: "new_records",
        message: `${preview.newStores.length} store(s) not set up yet will be added at the company level: ${preview.newStores.slice(0, 20).join(", ")}${preview.newStores.length > 20 ? "…" : ""}` });
    }
    if (preview.newPeople) {
      issues.push({ severity: "info", check: "new_records", message: `${preview.newPeople} new rep(s) will be added.` });
    }

    // Which stores to hold, and whether the whole day must wait.
    const heldStores = [...new Set(issues.filter((i) => i.severity === "error" && i.storeNumber).map((i) => i.storeNumber!))].sort((a, b) => Number(a) - Number(b));
    const fileProblems = issues.filter((i) => i.severity === "error" && !i.storeNumber).length;
    const storeCount = parsed.find((f) => f.type === "mtd")?.records.length ?? merged.storeRows.size;
    const tooMany = heldStores.length > Math.max(MIN_HELD_BEFORE_DAY_HOLD, storeCount * MAX_HELD_SHARE);
    if (tooMany) {
      issues.unshift({ severity: "error", check: "files",
        message: `${heldStores.length.toLocaleString()} of ${storeCount.toLocaleString()} stores don't match. That usually means one of the files is wrong (a different day, or a filter left on), so the whole day is on hold.` });
    }

    await putFile(parsedKey(batchId), JSON.stringify(parsed));
    const counts = { error: 0, warning: 0, info: 0 };
    for (const i of issues) counts[i.severity]++;
    await withDealer(dealerId, async (sql) => {
      await sql`delete from reconciliation_issues where batch_id = ${batchId}`;
      const rows = issues.slice(0, MAX_ISSUES_STORED).map((i) => ({
        batch_id: batchId, dealer_id: dealerId, severity: i.severity, check_name: i.check, store_id: null, store_number: i.storeNumber ?? null,
        kpi_code: i.kpi ?? null, expected: i.expected ?? null, actual: i.actual ?? null, message: i.message,
      }));
      for (let k = 0; k < rows.length; k += 1000) await sql`insert into reconciliation_issues ${sql(rows.slice(k, k + 1000))}`;
      if (result.dateThrough) await sql`update import_batches set biz_date = ${result.dateThrough}, date_source = ${result.dateSource} where id = ${batchId}`;
    });

    const summary = {
      checks: result.checks, issue_counts: counts, date_through: result.dateThrough,
      stores: merged.storeRows.size, reps: merged.repRows.length,
      held_stores: tooMany ? [] : heldStores, hold_whole_day: tooMany || fileProblems > 0,
    };
    if (summary.hold_whole_day) {
      await setStatus(dealerId, batchId, "needs_review", 60, summary);
      return;
    }
    await setStatus(dealerId, batchId, "saving", 65, summary);
    await saveBatch(batchId);
  } catch (e) {
    console.error(`Import ${batchId} failed`, e);
    await adminSql`update import_batches set status = 'failed', error = ${String((e as Error).message ?? e)}, finished_at = now() where id = ${batchId}`;
  }
}

/** Step B: write the day to the database (also used by "Save anyway"). */
export async function saveBatch(batchId: number) {
  const [batch] = await adminSql<BatchRow[]>`select id, dealer_id, status, biz_date, summary, uploaded_by from import_batches where id = ${batchId}`;
  if (!batch || !["saving", "needs_review"].includes(batch.status)) return;
  const dealerId = batch.dealer_id;
  try {
    await setStatus(dealerId, batchId, "saving", 70);
    const parsed = JSON.parse((await getFile(parsedKey(batchId))).toString("utf8")) as ParsedFile[];
    const merged = mergeDay(parsed);
    const bizDate = batch.biz_date.toISOString().slice(0, 10);
    // "Save anyway" on a day that was fully on hold saves every store.
    const held = new Set(batch.status === "needs_review" ? [] : ((batch.summary.held_stores as string[] | undefined) ?? []));
    await adminSql`select ensure_month_partitions(${bizDate}::date, ${bizDate}::date)`;
    await setStatus(dealerId, batchId, "saving", 80);
    const saved = await withDealer(dealerId, async (sql) => {
      const r = await saveDay(sql, dealerId, batchId, bizDate, merged, held);
      await sql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
                values (${dealerId}, ${batch.uploaded_by}, 'import.saved', 'import_batch', ${String(batchId)},
                        ${sql.json({ biz_date: bizDate, ...r, forced: batch.status === "needs_review" })})`;
      return r;
    });
    await setStatus(dealerId, batchId, "done", 100, { saved });
  } catch (e) {
    console.error(`Import ${batchId} failed while saving`, e);
    await adminSql`update import_batches set status = 'failed', error = ${String((e as Error).message ?? e)}, finished_at = now() where id = ${batchId}`;
  }
}

/** Saves held stores from the files after all. Runs right away (a few stores at most). */
export async function releaseHeldStores(dealerId: number, batchId: number, storeNumbers: string[] | "all", userId: number | null) {
  const [batch] = await adminSql<BatchRow[]>`select id, dealer_id, status, biz_date, summary, uploaded_by from import_batches where id = ${batchId} and dealer_id = ${dealerId}`;
  if (!batch || batch.status !== "done") throw new Error("Only the latest saved import for a day can release stores.");
  const parsed = JSON.parse((await getFile(parsedKey(batchId))).toString("utf8")) as ParsedFile[];
  const merged = mergeDay(parsed);
  const bizDate = batch.biz_date.toISOString().slice(0, 10);
  return withDealer(dealerId, async (sql) => {
    const stillHeld = (await sql<{ store_number: string }[]>`
      select store_number from import_held_stores where batch_id = ${batchId} and status = 'held'`).map((r) => r.store_number);
    const targets = storeNumbers === "all" ? stillHeld : storeNumbers.filter((n) => stillHeld.includes(n));
    if (!targets.length) return 0;
    const n = await releaseStores(sql, dealerId, batchId, bizDate, merged, targets, userId);
    await sql`insert into audit_log (dealer_id, user_id, action, entity, entity_id, details)
              values (${dealerId}, ${userId}, 'import.held_stores_saved', 'import_batch', ${String(batchId)},
                      ${sql.json({ biz_date: bizDate, stores: targets })})`;
    return n;
  });
}
