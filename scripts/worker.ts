/**
 * Runs the import worker as its own process (for when the web server has IMPORT_WORKER=off).
 *
 *   npm run worker
 */
import { startWorker } from "../src/lib/jobs";

startWorker().catch((e) => {
  console.error(e);
  process.exit(1);
});
