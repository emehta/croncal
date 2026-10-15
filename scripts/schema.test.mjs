/**
 * supabase/schema.sql, read as text: the rules that keep it safe to paste
 * into a stranger's project again and again. A new version of it is run over
 * an older project's tables, so anything that is not safe to run twice, or
 * that drops something, loses someone's events.
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
const guard = sql.slice(0, sql.indexOf("CREATE TABLE"));
check("before it makes anything, it stops if a table by its names is another app's",
  ["calendar_events", "google_auth"].every((name) => guard.includes(`to_regclass('public.${name}')`)) && /USING 'croncal'/.test(guard) && /RAISE EXCEPTION/.test(guard), true);
// A function's body runs when the app calls it, not when the schema is pasted in, so it is read apart.
const bodies = [...sql.matchAll(/\$fn\$([\s\S]*?)\$fn\$/g)].map(([, body]) => body);
const script = sql.replace(/\$fn\$[\s\S]*?\$fn\$/g, "");
check("it never drops, truncates or deletes anything", /\b(DROP\s+(TABLE|POLICY|INDEX|FUNCTION|SCHEMA|COLUMN|TRIGGER|VIEW)|TRUNCATE\s|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+DROP)\b/i.test(script), false);
check("nor does any function, beyond events and their changed days", bodies.some((body) => /\b(DROP|TRUNCATE|ALTER)\b/i.test(body) || /DELETE\s+FROM\s+(?!public\.calendar_events\b)/i.test(body)), false);

// The functions a change to a series runs in, each one transaction.
const functions = [...sql.matchAll(/CREATE (OR REPLACE )?FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$fn\$/g)];
check("it makes the functions a change to a series runs in",
  ["croncal_change_day", "croncal_delete_day", "croncal_delete_event", "croncal_delete_following", "croncal_change_series", "croncal_split_series"]
    .filter((name) => !functions.some(([, , made]) => made === name)), []);
for (const [, replace, name, , head] of functions) {
  check(`${name}: replaced when it exists, so the schema runs again`, Boolean(replace), true);
  check(`${name}: runs as the caller, so the row rules still apply`, /SECURITY INVOKER/.test(head) && !/SECURITY DEFINER/.test(head), true);
  check(`${name}: finds nothing on a search path`, /SET search_path = ''/.test(head), true);
  check(`${name}: only the signed-in role can call it`,
    new RegExp(`REVOKE ALL ON FUNCTION[^;]*public\\.${name}\\([^;]*FROM PUBLIC, anon, service_role;`).test(script) &&
      new RegExp(`GRANT EXECUTE ON FUNCTION[^;]*public\\.${name}\\([^;]*TO authenticated;`).test(script) &&
      !new RegExp(`GRANT [^;]*public\\.${name}\\([^;]*TO [^;]*\\b(anon|PUBLIC)\\b`).test(script), true);
}

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
