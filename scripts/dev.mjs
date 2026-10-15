#!/usr/bin/env node
/**
 * `npm run develop`: Next's development server, for working on CronCal's code.
 *
 *   npm run develop                    http://localhost:3202
 *   npm run develop -- --port 3206     another port
 *
 * It keeps its settings (the project it is connected to, the Google client)
 * in .dev-data in this folder, which git ignores, and listens on its own
 * port. So it never reads or changes the project an installed CronCal on this
 * computer uses, and both can run at once. Connect it to a test project of
 * its own. CRONCAL_DATA_DIR, when set, wins.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
// The last --port wins, so `npm run develop -- --port N` overrides any before it.
const portArg = args.lastIndexOf("--port");
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 3202;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error("The port must be a number from 1024 to 65535.");
  process.exit(1);
}
if (!existsSync(NEXT)) {
  console.error("Run npm install first.");
  process.exit(1);
}

const env = { ...process.env, CRONCAL_DATA_DIR: process.env.CRONCAL_DATA_DIR || path.join(ROOT, ".dev-data") };
console.log(`Settings: ${env.CRONCAL_DATA_DIR}\nOpen http://localhost:${PORT}\n`);
const server = spawn(process.execPath, [NEXT, "dev", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, env, stdio: "inherit" });
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
