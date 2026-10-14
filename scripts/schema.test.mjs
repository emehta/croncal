/**
 * supabase/schema.sql, read as text: the rules that keep it safe to paste
 * into a stranger's project again and again. A new version of it is run over
 * an older project's tables, so anything that is not safe to run twice, or
 * that drops something, loses someone's tasks.
 */

import { readFileSync } from "node:fs";
import { SCHEMA_VERSION } from "@/selfhost/constants";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

const raw = readFileSync("supabase/schema.sql", "utf8");
// Comments out, so a word in one is not read as SQL.
const sql = raw.replace(/--.*$/gm, "");

const version = sql.match(/VALUES\s*\('croncal',\s*(\d+)\)/)?.[1];
check("the version the SQL writes is the one the app asks for", Number(version), SCHEMA_VERSION);
check("it runs as one transaction", [/^\s*BEGIN;/m.test(sql), /COMMIT;\s*$/.test(sql)], [true, true]);
check("the version is written last, so a row there means everything ran", /INSERT INTO public\.schema_versions[\s\S]*COMMIT;\s*$/.test(sql) && !/INSERT INTO public\.schema_versions[\s\S]*CREATE /.test(sql), true);
check("it never drops, truncates or deletes anything", /\b(DROP\s+(TABLE|POLICY|INDEX|FUNCTION|SCHEMA|COLUMN|TRIGGER|VIEW)|TRUNCATE\s|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+DROP)\b/i.test(sql), false);

const tables = [...sql.matchAll(/CREATE TABLE (IF NOT EXISTS )?public\.(\w+)/g)];
check("every table is created only if missing", tables.filter(([, guard]) => !guard).map(([, , name]) => name), []);
check("every index is created only if missing", [...sql.matchAll(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)].length, 0);

const names = tables.map(([, , name]) => name);
check("it makes the tables the app reads", ["app_owner", "app_settings", "schema_versions", "calendar_events", "google_auth"].every((name) => names.includes(name)), true);
for (const name of names) {
  check(`${name}: row level security is on`, new RegExp(`ALTER TABLE public\\.${name} ENABLE ROW LEVEL SECURITY`).test(sql), true);
  check(`${name}: signed-out visitors get nothing`, new RegExp(`REVOKE ALL ON [^;]*public\\.${name}\\b[^;]*FROM anon`).test(sql), true);
}
check("the browser can never read the server's own tables",
  /REVOKE ALL ON public\.app_owner, public\.app_settings, public\.schema_versions FROM anon, authenticated/.test(sql), true);
check("nor the Google tokens", /REVOKE ALL ON public\.google_auth FROM anon, authenticated/.test(sql) && !/GRANT [^;]* ON [^;]*google_auth[^;]* TO authenticated/.test(sql), true);
check("the events grant the signed-in role only the four it needs",
  /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.calendar_events TO authenticated/.test(sql), true);
check("a zone is never assumed to be one city's", /DEFAULT 'America\//.test(sql), false);
check("every row of a user goes when the user goes", (sql.match(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/g) ?? []).length >= 3, true);
check("a policy is changed in place when it exists, so an update reaches older projects", /ALTER POLICY/.test(sql) && /CREATE POLICY/.test(sql), true);
check("the rule needs the owner flag, not only a signed-in user", /self_host_owner/.test(sql), true);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`schema: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`schema: ${passed} passed`);
