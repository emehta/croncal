/**
 * Where a copy finds its project (src/selfhost/config.ts), against a real
 * folder: the file, the environment variables, and every way either can be
 * wrong. A mistake here sends a user back to Connect for no reason, keeps
 * them in a loop, or breaks every page with a 500.
 */

import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

const ENV = [
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL",
];
for (const name of ENV) delete process.env[name];
const dir = mkdtempSync(path.join(os.tmpdir(), "croncal-config-test-"));
process.env.CRONCAL_DATA_DIR = dir;

const config = await import("@/selfhost/config");
const { SetupError } = await import("@/selfhost/server");
const file = path.join(dir, "config.json");
const good = { url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_a", secretKey: "sb_secret_a" };
const write = (value) => {
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  // A new time each write, so the reader's cache cannot hide one.
  const later = new Date(Date.now() + Math.floor(Math.random() * 100000));
  import("node:fs").then(({ utimesSync }) => utimesSync(file, later, later));
};

try {
  // ─── The address ───
  check("a trailing slash is taken off", config.normalizeUrl("https://abc.supabase.co/"), "https://abc.supabase.co");
  check("spaces around it are taken off", config.normalizeUrl("  https://abc.supabase.co  "), "https://abc.supabase.co");
  check("no scheme is refused", config.normalizeUrl("abc.supabase.co"), null);
  check("plain http is refused", config.normalizeUrl("http://abc.supabase.co"), null);
  check("a path is refused", config.normalizeUrl("https://abc.supabase.co/rest/v1"), null);
  check("nothing is nothing", config.normalizeUrl(""), null);

  // ─── The file ───
  check("no file means not connected", await config.readAppConfig(), null);
  write("{ this is not json");
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("a file that does not parse means connect again, not a crash", await config.readAppConfig(), null);
  write({ ...good, url: "https://abcdefghijklmnopqrst.supabase.co/" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("a saved address with a trailing slash reads without it", (await config.readAppConfig())?.url, good.url);
  write({ url: "abcdefghijklmnopqrst.supabase.co", publishableKey: "x", secretKey: "y" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("a saved address with no scheme means connect again", await config.readAppConfig(), null);

  await config.writeAppConfig(good);
  check("a saved config reads back", await config.readAppConfig(), good);
  if (process.platform !== "win32") check("only its owner can read it", (statSync(file).mode & 0o777).toString(8), "600");

  await Promise.all(Array.from({ length: 6 }, (_, i) => config.writeAppConfig({ ...good, publishableKey: `sb_publishable_${i}` })));
  const after = await config.readAppConfig();
  check("six saves at once leave one whole file", Boolean(after && after.publishableKey.startsWith("sb_publishable_")), true);
  check("and no temporary files behind", readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);

  check("the browser's half never carries the secret", Object.keys(config.browserHalf(good)).sort(), ["publishableKey", "url"]);

  // A folder where the file should be: it exists but cannot be read.
  rmSync(file);
  mkdirSync(file);
  let thrown = null;
  try { await config.readAppConfig(); } catch (error) { thrown = error; }
  check("a file that exists but cannot be read is an error naming the folder, not 'not connected'",
    thrown instanceof SetupError && thrown.message.includes(dir), true);
  rmSync(file, { recursive: true });
  await config.writeAppConfig(good);

  // ─── Environment variables ───
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://zyxwvutsrqponmlkjihg.supabase.co/";
  check("a variable set at all means the project comes from the environment", config.configFromEnvironment(), true);
  check("half the variables are no config, even with a file saved", await config.readAppConfig(), null);
  check("and the missing ones are named", config.environmentProblems(), [
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.",
    "SUPABASE_SECRET_KEY is not set.",
  ]);
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_env";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_env";
  check("complete variables win over the file", await config.readAppConfig(), {
    url: "https://zyxwvutsrqponmlkjihg.supabase.co",
    publishableKey: "sb_publishable_env",
    secretKey: "sb_secret_env",
  });
  check("complete variables have no problems", config.environmentProblems(), []);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "zyxwvutsrqponmlkjihg.supabase.co";
  check("a variable address with no scheme is named as wrong", config.environmentProblems()[0]?.includes("not an https address"), true);
  check("and gives no config", await config.readAppConfig(), null);
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;

  process.env.VERCEL = "1";
  check("on the web the file is never read", await config.readAppConfig(), null);
  check("on the web it is always the environment", config.onTheWeb(), true);
  delete process.env.VERCEL;
  check("back on this computer the file is read again", (await config.readAppConfig())?.secretKey, good.secretKey);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`config: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`config: ${passed} passed`);
