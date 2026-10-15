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
import net from "node:net";
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
const VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const PORT_TAKEN = `Another program is using port ${PORT}. Close it, or start CronCal on another port: npm start -- --port ${PORT + 4}`;

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  stop(`CronCal needs Node 22.18 or newer, and this computer has ${process.versions.node}. Install the current LTS from nodejs.org, then run npm start again.`);
}
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) stop("The port must be a number from 1024 to 65535.");
if (!PREBUILT && !existsSync(path.join(ROOT, "src"))) stop("This copy of CronCal is incomplete. Download it again, as the README says.");
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

/** Who answers on the port: CronCal (with its version, if it says), another program, or nobody. */
async function answering() {
  let response;
  try {
    response = await fetch(HEALTH, { signal: AbortSignal.timeout(1500), redirect: "manual" });
  } catch {
    return null;
  }
  const body = await response.json().catch(() => null);
  return body?.app === "croncal" ? { app: "croncal", version: typeof body.version === "string" ? body.version : null } : { app: "other" };
}

/** Whether `a` is an older version than `b`. One that doesn't say (before 1.1.2) is older. */
function older(a, b) {
  if (!a) return true;
  const [x, y] = [a, b].map((v) => v.split(".").map((part) => Number.parseInt(part, 10) || 0));
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/*
 * A browser asks for localhost on [::1] first and on 127.0.0.1 only when
 * nothing answers there, while the server listens on 127.0.0.1 alone. So a
 * program on [::1] at this port would get the page instead: it is refused
 * before starting, and while CronCal runs this script holds [::1] itself and
 * passes each connection on. A computer with IPv6 off has no [::1] at all.
 */
function ipv6Taken() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "::1", port: PORT });
    const done = (taken) => {
      socket.destroy();
      resolve(taken);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function holdIpv6() {
  return new Promise((resolve) => {
    const relay = net.createServer((client) => {
      const upstream = net.connect({ host: HOST, port: PORT });
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
    relay.on("error", (error) => {
      if (relay.listening) return;
      if (error.code === "EADDRINUSE") stop(PORT_TAKEN);
      // EADDRNOTAVAIL or EAFNOSUPPORT: IPv6 is off, and 127.0.0.1 alone serves.
      resolve();
    });
    relay.listen({ host: "::1", port: PORT }, resolve);
  });
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
if (already?.app === "croncal" && already.version !== VERSION) {
  stop(older(already.version, VERSION)
    ? "An older copy of CronCal is still running. Close its window, then run npm start again."
    : `A newer copy of CronCal (${already.version}) is running. Close its window, then run npm start again.`);
}
if (already?.app === "croncal") {
  console.log(`CronCal is already running at ${APP_URL}.`);
  openBrowser();
  process.exit(0);
}
if (already?.app === "other" || (await ipv6Taken())) stop(PORT_TAKEN);
await holdIpv6();

if (!PREBUILT) {
  const stamp = buildStamp();
  const built = existsSync(path.join(ROOT, ".next", "BUILD_ID")) && existsSync(STAMP) && readFileSync(STAMP, "utf8") === stamp;
  if (!built) {
    console.log("Building CronCal. The first time takes a minute.\n");
    const env = { ...process.env, CRONCAL_SKIP_TYPECHECK: "1" };
    const result = spawnSync(process.execPath, [NEXT, "build"], { stdio: "inherit", env });
    if (result.status !== 0) stop("The build stopped with an error (above). If you changed nothing, run npm install, then npm start.");
    writeFileSync(STAMP, stamp);
  }
}

const server = PREBUILT
  ? spawn(process.execPath, [SERVER], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOSTNAME: HOST, PORT: String(PORT) } })
  : spawn(process.execPath, [NEXT, "start", "-H", HOST, "-p", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
let ready = false;
/* Watched for a taken port, to tell it from any other failure. */
let portInUse = false;
server.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  if (text.includes("EADDRINUSE")) portInUse = true;
  // Only errors reach the terminal.
  if (/error/i.test(text)) process.stdout.write(text);
});
/* Held until the server answers: a taken port then shows one sentence, not
   Node's stack trace, and any other failure shows what the server said. */
let early = "";
server.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  if (text.includes("EADDRINUSE")) portInUse = true;
  if (ready) process.stderr.write(text);
  else early += text;
});
server.on("exit", (code) => {
  if (!ready && code) {
    if (portInUse) stop(PORT_TAKEN);
    process.stderr.write(early);
    stop("CronCal stopped while starting, with the error above. Run npm start again.");
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
  if ((await answering())?.app === "croncal") {
    ready = true;
    process.stderr.write(early);
    console.log(`\nCronCal is running at ${APP_URL}\nKeep this window open: closing it stops CronCal.\n`);
    openBrowser();
  } else if (!toldSlow && Date.now() - startedAt > 30_000) {
    toldSlow = true;
    console.log("\nCronCal is still starting. It opens in your browser when it's ready.\n");
  }
}
