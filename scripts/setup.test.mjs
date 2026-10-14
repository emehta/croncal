/**
 * Setup: what a pasted key is, and which screen each state shows.
 *
 * Both decide what a stranger setting this up sees, and neither leaves a
 * trace when wrong: a key sorted into the wrong slot reads as "Supabase did
 * not accept those keys", and a wrong step is a screen that asks for
 * something already done.
 */

import { dashboardLinks, jwtRole, projectRef, sortPasted } from "@/selfhost/keys";
import { nextStep, serverState } from "@/selfhost/steps";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

const URL = "https://abcdefghijklmnopqrst.supabase.co";
const PUBLISHABLE = "sb_publishable_testtesttest";
const SECRET = "sb_secret_testtesttest";
const jwt = (role) => {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase", role })}.signature`;
};

// ─── Pasted keys ───
check("all three in their boxes", sortPasted(`${URL}\n${PUBLISHABLE}\n${SECRET}`), { url: URL, publishableKey: PUBLISHABLE, secretKey: SECRET });
check("keys swapped between boxes are sorted back", sortPasted(`${SECRET}\n${PUBLISHABLE}\n${URL}`), { url: URL, publishableKey: PUBLISHABLE, secretKey: SECRET });
check("a URL with a path and a trailing slash", sortPasted(`${URL}/rest/v1/`).url, URL);
check("a URL pasted with spaces around it", sortPasted(`   ${URL}   `).url, URL);
check("a non-Supabase URL is no project", sortPasted("https://example.com").url, null);
check("a missing secret is missing", sortPasted(`${URL} ${PUBLISHABLE}`).secretKey, null);
check("legacy anon key reads as publishable", sortPasted(jwt("anon")).publishableKey, jwt("anon"));
check("legacy service_role key reads as secret", sortPasted(jwt("service_role")).secretKey, jwt("service_role"));
check("a new key wins over a legacy one", sortPasted(`${jwt("anon")} ${PUBLISHABLE}`).publishableKey, PUBLISHABLE);
check("a JWT's role", jwtRole(jwt("service_role")), "service_role");
check("not a JWT has no role", jwtRole("hello.world"), null);
check("project ref", projectRef(URL), "abcdefghijklmnopqrst");
check("no project ref in a stranger's URL", projectRef("https://supabase.co"), null);
check("links go to that project", dashboardLinks("abcdefghijklmnopqrst").sqlEditor, "https://supabase.com/dashboard/project/abcdefghijklmnopqrst/sql/new");

// ─── Steps ───
const ready = { configured: true, onTheWeb: false, fromEnvironment: false, ref: "abcdefghijklmnopqrst", reach: "ok", schema: "ready", ownerExists: true };
const step = (status, session) => nextStep(serverState(status), session);
check("nothing heard yet", step(null, null), "loading");
check("a fresh copy connects first", step({ configured: false, onTheWeb: false, fromEnvironment: false }, "none"), "connect");
check("variables set but incomplete name what is missing, never the connect form", step({ configured: false, onTheWeb: false, fromEnvironment: true }, "none"), "environment");
check("variables that work go on as a saved project does", step({ ...ready, fromEnvironment: true, ownerExists: false }, "none"), "create-account");
check("a paused project", step({ ...ready, reach: "paused" }, "owner"), "paused");
check("an unreachable project", step({ ...ready, reach: "unreachable" }, "owner"), "unreachable");
check("keys that were reset", step({ ...ready, reach: "rejected" }, "owner"), "rejected");
check("no tables yet", step({ ...ready, schema: "missing", ownerExists: null }, "none"), "database");
check("older tables", step({ ...ready, schema: "outdated" }, "owner"), "update-database");
check("tables but no account", step({ ...ready, ownerExists: false }, "none"), "create-account");
check("an account made by the other app: sign in, never create", step({ ...ready, ownerExists: true }, "none"), "sign-in");
check("the session not known yet", step(ready, null), "loading");
check("a stranger who signed up through Supabase", step(ready, "stranger"), "not-owner");
check("the owner", step(ready, "owner"), "app");
check("a paused project outranks a session", step({ ...ready, reach: "paused" }, "stranger"), "paused");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`setup: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`setup: ${passed} passed`);
