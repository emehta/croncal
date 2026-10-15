#!/usr/bin/env node
/**
 * `npm run package`: the release download, dist/croncal.zip.
 *
 * One folder, croncal/, that runs with Node alone: Next's standalone server
 * with the files it reads, the start script and the launchers. The user
 * skips Git, npm install (130 MB, 448 packages) and the build. It holds no
 * native module, so the one file runs on macOS, Windows and Linux, which CI
 * checks by starting it on all three. The release workflow attaches it to
 * each GitHub release.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);
const OUT = path.join(ROOT, "dist");
const APP = path.join(OUT, "croncal");
const ZIP = path.join(OUT, "croncal.zip");
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

function stop(message) {
  console.error(`\npackage: ${message}\n`);
  process.exit(1);
}

if (!existsSync(NEXT)) stop("run npm install first.");
rmSync(OUT, { recursive: true, force: true });

// CI has checked the types before it packages, so the build does not again.
const built = spawnSync(process.execPath, [NEXT, "build"], {
  stdio: "inherit",
  env: { ...process.env, CRONCAL_BUNDLE: "1", CRONCAL_SKIP_TYPECHECK: "1" },
});
if (built.status !== 0) stop("the build failed (above).");
if (!existsSync(path.join(ROOT, ".next", "standalone", "server.js"))) stop("the build made no standalone server.");

cpSync(path.join(ROOT, ".next", "standalone"), APP, { recursive: true });
// The standalone server leaves the browser's files to the caller.
cpSync(path.join(ROOT, ".next", "static"), path.join(APP, ".next", "static"), { recursive: true });
for (const file of ["scripts/start.mjs", "Start CronCal.command", "Start CronCal.cmd", "README.md", "LICENSE.md"]) {
  cpSync(path.join(ROOT, file), path.join(APP, file));
}
// Copied beside the server by Next, read by nothing that runs.
for (const file of ["tsconfig.json", "extract.config.json"]) rmSync(path.join(APP, file), { force: true });

const native = [];
const secrets = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".node")) native.push(path.relative(APP, full));
    // Next copies .env and .env.production into the standalone server, secrets and all.
    else if (/^\.env/.test(entry) && entry !== ".env.example") secrets.push(path.relative(APP, full));
  }
};
walk(APP);
if (secrets.length > 0) stop(`the download would carry ${secrets.join(", ")}. Package from a clean checkout.`);
if (native.length > 0) stop(`a native module would tie the download to this system: ${native.join(", ")}`);

// Info-ZIP keeps the launcher's executable bit. Windows has no zip, but its tar
// writes one; GNU tar would write a plain tar under the .zip name instead.
const zip = spawnSync("zip", ["-qr", ZIP, "croncal"], { cwd: OUT, stdio: "inherit" });
if (zip.error || zip.status !== 0) {
  if (process.platform !== "win32") stop("zip is needed to make the archive. Install it (on Linux, apt install zip), then run this again.");
  const tar = spawnSync("tar", ["-a", "-cf", ZIP, "croncal"], { cwd: OUT, stdio: "inherit" });
  if (tar.error || tar.status !== 0) stop("neither zip nor tar could make the archive.");
}
if (readFileSync(ZIP).subarray(0, 2).toString("latin1") !== "PK") stop("the archive came out as something other than a zip.");
console.log(`package: ${path.relative(ROOT, ZIP)}, ${(statSync(ZIP).size / 1e6).toFixed(1)} MB`);
