/**
 * Hosted start: the website and the import worker as two separate programs in one
 * service (so reading big Excel files never slows the pages), plus the one-time setup.
 * If either program stops, the service stops so the host restarts it.
 *
 *   npm run start:all
 */
import { spawn } from "node:child_process";

const children = [];
function start(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", (code) => {
    if (name === "setup") return;
    console.log(`[start-all] ${name} stopped (code ${code}); stopping the service.`);
    for (const c of children) c.kill("SIGTERM");
    process.exit(code ?? 1);
  });
  children.push(child);
}

start("web", "npx", ["next", "start"], { IMPORT_WORKER: "off" });
start("worker", "npx", ["tsx", "scripts/worker.ts"]);
start("setup", "npx", ["tsx", "scripts/bootstrap.ts"]);

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    for (const c of children) c.kill(sig);
    setTimeout(() => process.exit(0), 5000);
  });
}
