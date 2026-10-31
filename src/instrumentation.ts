// Starts the background import worker inside the web server. For larger setups, set
// IMPORT_WORKER=off here and run `npm run worker` as its own process instead.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.IMPORT_WORKER !== "off") {
    const { startWorker } = await import("./lib/jobs");
    await startWorker();
  }
}
