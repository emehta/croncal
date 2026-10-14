#!/usr/bin/env node
/**
 * `npm start`: builds CronCal when it needs building, serves it on this
 * computer only, and opens it in the browser.
 *
 *   npm start                     http://localhost:3102
 *   npm start -- --port 3106      another port, if 3102 is taken
 *   npm start -- --no-open        without opening the browser
 *
 * From the source it builds on the first run and after an update (anything
 * in the app's files changed since the last build), and not otherwise, so
 * starting it again each day takes a second. The release download
 * (scripts/package.mjs) is built already and only starts. Already running?
 * It opens the browser on the copy that is running and stops there.
 *
 * Written for a person who has never used a terminal: every way it can stop
 * says what to do next in one sentence, with no stack trace.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
// The last --port wins, so `npm start -- --port 3106` overrides package.json's.
const portArg = args.lastIndexOf("--port");
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 3102;
const OPEN = !args.includes("--no-open");
const HOST = "127.0.0.1";
/* The address a person uses; the server listens on HOST (src/proxy.ts sends 127.0.0.1 here). */
const APP_URL = `http://localhost:${PORT}`;
const HEALTH = `http://${HOST}:${PORT}/api/health`;
/* The app's own folder, wherever the command was typed from. */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const STAMP = path.join(ROOT, ".next", "croncal-build-stamp");
/* The release download carries Next's own server in place of the sources. */
const SERVER = path.join(ROOT, "server.js");
const PREBUILT = existsSync(SERVER);

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  stop(`CronCal needs Node 22.18 or newer, and this computer has ${process.versions.node}. Install the current LTS from nodejs.org, then run npm start again.`);
}
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) stop("The port must be a number from 1024 to 65535.");
if (!PREBUILT && !existsSync(NEXT)) stop("CronCal's packages are not installed yet. Run npm install in this folder, then npm start.");

/** A fingerprint of everything a build depends on: each file's path, size and time. */
function buildStamp() {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // Finder's folder notes change when a folder is looked at, not when the app does.
      if (entry.name === ".DS_Store") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const info = statSync(full);
        hash.update(`${path.relative(ROOT, full)}|${info.size}|${info.mtimeMs}\n`);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  for (const file of ["package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) {
    const full = path.join(ROOT, file);
    if (existsSync(full)) {
      const info = statSync(full);
      hash.update(`${file}|${info.size}|${info.mtimeMs}\n`);
    }
  }
  return hash.digest("hex");
}

/** Who answers on the port: CronCal, another program, or nobody. */
async function answering() {
  let response;
  try {
    response = await fetch(HEALTH, { signal: AbortSignal.timeout(1500), redirect: "manual" });
  } catch {
    return null;
  }
  const body = await response.json().catch(() => null);
  return body?.app === "croncal" ? "croncal" : "other";
}

function openBrowser() {
  if (!OPEN) return;
  const [command, commandArgs] =
    process.platform === "darwin" ? ["open", [APP_URL]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", APP_URL]]
    : ["xdg-open", [APP_URL]];
  const opener = spawn(command, commandArgs, { stdio: "ignore", detached: true });
  // No browser opener (a Linux without xdg-open): the address is printed anyway.
  opener.on("error", () => console.log(`Open ${APP_URL} in your browser.`));
  opener.unref();
}

const already = await answering();
/* PUBLIK_SELF_TEST=1 npm start is publik's check that the built app reaches
   publik's AI (src/instrumentation.ts): it needs the port to itself. */
if (already === "croncal" && process.env.PUBLIK_SELF_TEST) {
  stop("CronCal is already running. Close its window, then run the self-test again.");
}
if (already === "croncal") {
  console.log(`CronCal is already running at ${APP_URL}.`);
  openBrowser();
  process.exit(0);
}
if (already === "other") {
  stop(`Another program is using port ${PORT}. Close it, or start CronCal on another port: npm start -- --port ${PORT + 4}`);
}

if (!PREBUILT) {
  const stamp = buildStamp();
  const built = existsSync(path.join(ROOT, ".next", "BUILD_ID")) && existsSync(STAMP) && readFileSync(STAMP, "utf8") === stamp;
  if (!built) {
    console.log("Building CronCal. The first time takes a minute.\n");
    const env = { ...process.env, CRONCAL_SKIP_TYPECHECK: "1" };
    delete env.PUBLIK_SELF_TEST;
    const result = spawnSync(process.execPath, [NEXT, "build"], { stdio: "inherit", env });
    if (result.status !== 0) stop("The build stopped with an error (above). If you changed nothing, run npm install, then npm start.");
    writeFileSync(STAMP, stamp);
  }
}

const server = PREBUILT
  ? spawn(process.execPath, [SERVER], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, HOSTNAME: HOST, PORT: String(PORT) } })
  : spawn(process.execPath, [NEXT, "start", "-H", HOST, "-p", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
server.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  // Errors, and publik's self-test line (PUBLIK_SELF_TEST=1 npm start), reach the terminal.
  if (/error|publik self-test/i.test(text)) process.stdout.write(text);
});
let ready = false;
server.on("exit", (code) => {
  if (!ready && code) {
    stop(`CronCal stopped while starting. If another program is using port ${PORT}, close it, or start CronCal on another port: npm start -- --port ${PORT + 4}`);
  }
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));

/* Until it answers, however long a slow computer takes; the server exiting
   ends this script through its exit handler above. */
const startedAt = Date.now();
let toldSlow = false;
while (!ready) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if ((await answering()) === "croncal") {
    ready = true;
    console.log(`\nCronCal is running at ${APP_URL}\nKeep this window open: closing it stops CronCal.\n`);
    openBrowser();
  } else if (!toldSlow && Date.now() - startedAt > 30_000) {
    toldSlow = true;
    console.log("\nCronCal is still starting. It opens in your browser when it's ready.\n");
  }
}
