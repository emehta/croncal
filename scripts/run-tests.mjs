/**
 * Runs every suite in scripts/: `npm test`.
 *
 * The suites are plain node scripts that assert and exit non-zero (see
 * CONTRIBUTING.md for why there is no framework). Every `*.test.mjs` here
 * runs, found by name, so a new suite needs no list to be added to.
 *
 * Each suite gets its own process, so one that throws at import time cannot
 * take the others down with it, and all of them run before the result is
 * reported, so one failure never hides another.
 *
 *   npm test                 every suite
 *   npm test -- task setup   only the suites whose file name contains one of these
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPTS);
const filters = process.argv.slice(2);

const suites = readdirSync(SCRIPTS)
  .filter((file) => file.endsWith(".test.mjs"))
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort();

if (suites.length === 0) {
  console.error(`No suite matches ${filters.join(", ")}.`);
  process.exit(1);
}

const failed = [];
for (const suite of suites) {
  console.log(`\n▸ ${suite}`);
  const result = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      "./scripts/alias-loader.mjs",
      join("scripts", suite),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (result.status !== 0) failed.push(suite);
}

console.log(`\n${suites.length - failed.length} of ${suites.length} suites passed.`);
if (failed.length > 0) {
  console.error(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
