import { PgBoss } from "pg-boss";

/**
 * Background jobs (pg-boss keeps its queue in Postgres, so there's no extra service).
 * Imports run here so a big upload never freezes the page.
 */
const QUEUE_CHECK = "import-check";
const QUEUE_SAVE = "import-save";

declare global {
  var __ddBoss: Promise<PgBoss> | undefined;
  var __ddWorkerStarted: boolean | undefined;
}

function boss(): Promise<PgBoss> {
  globalThis.__ddBoss ??= (async () => {
    const url = process.env.DATABASE_ADMIN_URL;
    if (!url) throw new Error("DATABASE_ADMIN_URL is not set");
    const b = new PgBoss(url);
    b.on("error", (e) => console.error("job queue error", e));
    await b.start();
    await b.createQueue(QUEUE_CHECK);
    await b.createQueue(QUEUE_SAVE);
    return b;
  })();
  return globalThis.__ddBoss;
}

export async function queueImportCheck(batchId: number) {
  await (await boss()).send(QUEUE_CHECK, { batchId });
}

export async function queueImportSave(batchId: number) {
  await (await boss()).send(QUEUE_SAVE, { batchId });
}

export async function startWorker() {
  if (globalThis.__ddWorkerStarted) return;
  globalThis.__ddWorkerStarted = true;
  const b = await boss();
  const { checkBatch, saveBatch } = await import("./imports/process");
  await b.work<{ batchId: number }>(QUEUE_CHECK, { pollingIntervalSeconds: 1 }, async ([job]) => checkBatch(job.data.batchId));
  await b.work<{ batchId: number }>(QUEUE_SAVE, { pollingIntervalSeconds: 1 }, async ([job]) => saveBatch(job.data.batchId));
  console.log("Import worker started");
}
