#!/usr/bin/env node
/**
 * What a new user's computer does first, end to end: `npm start` on a copy
 * connected to nothing, then the checks that it answers, asks for setup,
 * moves 127.0.0.1 to localhost, refuses another site's write, and has no
 * secret in what it sends the browser. Runs in CI on macOS, Windows and
 * Linux (.github/workflows/ci.yml), and here with `node scripts/smoke.mjs`.
 *
 *   node scripts/smoke.mjs                  this folder, from the source
 *   node scripts/smoke.mjs <unzipped croncal> the release download (npm run package)
 */

import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3192;
const APP = path.resolve(process.argv[2] ?? ".");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "croncal-smoke-"));
const failures = [];
let passed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const server = spawn(process.execPath, [path.join(APP, "scripts", "start.mjs"), "--port", String(PORT), "--no-open"], {
  // Every name config.ts reads, emptied, so a developer's .env.local can't connect the copy under test.
  env: {
    ...process.env,
    CRONCAL_DATA_DIR: dataDir,
    ...Object.fromEntries(
      ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((name) => [name, ""]),
    ),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

function finish(code) {
  // On Windows a kill reaches start.mjs alone; the server it started would outlive the run.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}

const started = Date.now();
while (!output.includes("CronCal is running")) {
  if (server.exitCode !== null || Date.now() - started > 300_000) {
    console.error(output);
    console.error("smoke: CronCal did not start.");
    finish(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const base = `http://127.0.0.1:${PORT}`;
const health = await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null);
check("it says it is CronCal", health?.app === "croncal");

const status = await fetch(`${base}/api/selfhost/status`).then((r) => r.json()).catch(() => null);
check("a fresh copy asks to be connected", status?.configured === false, JSON.stringify(status));

const moved = await fetch(`${base}/calendar?x=1`).then((r) => r.text()).catch(() => "");
check("a page on 127.0.0.1 moves to localhost", moved.includes(`location.replace("http://localhost:${PORT}/calendar?x=1")`));

const page = await fetch(`http://localhost:${PORT}/calendar`, { redirect: "manual" }).catch(() => null);
check("localhost serves the app", page?.status === 200, String(page?.status));

const write = await fetch(`http://localhost:${PORT}/api/selfhost/connect`, {
  method: "POST",
  headers: { origin: "https://attacker.example", "content-type": "text/plain" },
  body: "{}",
}).catch(() => null);
check("another site's write is refused", write?.status === 403, String(write?.status));

const own = { origin: `http://localhost:${PORT}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const empty = await fetch(`http://localhost:${PORT}/api/selfhost/connect`, { method: "POST", headers: own, body: "{}" }).catch(() => null);
check("the app's own connect with nothing in it is a plain 400", empty?.status === 400, String(empty?.status));
const schema = await fetch(`http://localhost:${PORT}/api/selfhost/schema`).catch(() => null);
const schemaText = schema ? await schema.text() : "";
check("the setup SQL is served", schema?.status === 200 && schemaText.includes("CREATE TABLE IF NOT EXISTS public.calendar_events"), String(schema?.status));

// fetch drops a Host header it is given, so this one is sent by hand.
const foreign = await new Promise((resolve) => {
  http.get({ host: "127.0.0.1", port: PORT, path: "/calendar", headers: { host: `attacker.example:${PORT}` } }, (response) => {
    response.resume();
    resolve(response.statusCode);
  }).on("error", () => resolve(null));
});
check("a foreign Host (DNS rebinding) is refused", foreign === 421, String(foreign));

/*
 * Connected to a made-up project. The config is read on each request, so no
 * restart: the page now carries the publishable key, which shows the config
 * reached it, and must still carry nothing of the secret key.
 */
const FAKE = {
  url: "https://smoketestsmoketestsm.supabase.co",
  publishableKey: "sb_publishable_smoketest",
  secretKey: "sb_secret_smoketest",
};
writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(FAKE), { mode: 0o600 });
const connected = await fetch(`http://localhost:${PORT}/calendar`).then((r) => r.text()).catch(() => "");
check("a connected page carries the publishable key", connected.includes(FAKE.publishableKey));
check("a connected page carries no secret key", !connected.includes(FAKE.secretKey));
const connectedStatus = await fetch(`${base}/api/selfhost/status`).then((r) => r.text()).catch(() => "");
check("the status carries no secret key", connectedStatus !== "" && !connectedStatus.includes(FAKE.secretKey));

let leaked = false;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|css|html|json)$/.test(entry) && /sb_secret_[A-Za-z0-9_-]{16,}/.test(readFileSync(full, "utf8"))) leaked = true;
  }
};
walk(path.join(APP, ".next", "static"));
check("the built browser files carry no secret key", !leaked);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`smoke: ${failures.length} failed, ${passed} passed`);
  finish(1);
}
console.log(`smoke: ${passed} passed`);
finish(0);
