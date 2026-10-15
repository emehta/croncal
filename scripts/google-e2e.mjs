#!/usr/bin/env node
/**
 * Google Calendar end to end, with no Google account: CronCal is started
 * against the stand-in (scripts/google-stand-in.mjs) and a real Supabase test
 * project, then driven through connect, sync and disconnect as the browser
 * drives it.
 *
 *   CRONCAL_E2E_DATA_DIR=<folder with a test project's config.json> \
 *   CRONCAL_E2E_EMAIL=<owner> CRONCAL_E2E_PASSWORD=<password> \
 *   node scripts/google-e2e.mjs
 *
 * It needs a project of its own (it saves and removes a Google client and
 * tokens there), so it is not part of `npm test` or CI. It leaves the project
 * as it found it: no client, no Google connection.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createStandIn, STAND_IN } from "./google-stand-in.mjs";

const DATA = process.env.CRONCAL_E2E_DATA_DIR;
const EMAIL = process.env.CRONCAL_E2E_EMAIL;
const PASSWORD = process.env.CRONCAL_E2E_PASSWORD;
if (!DATA || !EMAIL || !PASSWORD) {
  console.error("Set CRONCAL_E2E_DATA_DIR, CRONCAL_E2E_EMAIL and CRONCAL_E2E_PASSWORD.");
  process.exit(1);
}
const STAND_IN_PORT = 3193;
const PORT = 3194;
const APP = `http://localhost:${PORT}`;

const failures = [];
let passed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const { server: standIn, log } = createStandIn();
await new Promise((resolve) => standIn.listen(STAND_IN_PORT, "127.0.0.1", resolve));

const app = spawn(process.execPath, ["scripts/start.mjs", "--port", String(PORT), "--no-open"], {
  env: { ...process.env, CRONCAL_DATA_DIR: DATA, CRONCAL_GOOGLE_STAND_IN: `http://127.0.0.1:${STAND_IN_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
app.stdout.on("data", (chunk) => { output += chunk; });
app.stderr.on("data", (chunk) => { output += chunk; });

function finish(code) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  else app.kill();
  standIn.close();
  process.exit(code);
}

const started = Date.now();
while (!output.includes("CronCal is running")) {
  if (app.exitCode !== null || Date.now() - started > 300_000) {
    console.error(output);
    console.error("google-e2e: CronCal did not start.");
    finish(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const config = JSON.parse(readFileSync(path.join(DATA, "config.json"), "utf8"));
const supabase = createClient(config.url, config.publishableKey, { auth: { persistSession: false } });
const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInError) {
  console.error(`google-e2e: could not sign in: ${signInError.message}`);
  finish(1);
}
const token = signedIn.session.access_token;

/** A request as CronCal's own page sends it. */
async function api(route, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${APP}${route}`, {
    method,
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      origin: APP,
      "sec-fetch-site": "same-origin",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, headers: response.headers };
}

/* The list route answers with the events themselves, an array. */
const listedEvents = (answer) => (Array.isArray(answer.json) ? answer.json : []);

const cookiesFrom = (headers) => headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");

try {
  // ─── Before ───
  let status = await api("/api/auth/google/status");
  check("starts disconnected", status.json?.connected === false, JSON.stringify(status.json));
  check("connecting with no client says to add one", (await api("/api/auth/google?connect=true")).status === 409);

  // ─── The owner's client ───
  check("a wrong client ID is refused", (await api("/api/google/client", { method: "PUT", body: { clientId: "not-an-id", clientSecret: "x".repeat(20) } })).status === 400);
  const saved = await api("/api/google/client", { method: "PUT", body: { clientId: STAND_IN.clientId, clientSecret: STAND_IN.clientSecret } });
  check("the client is saved", saved.json?.saved === true && saved.json?.clientId === STAND_IN.clientId, JSON.stringify(saved.json));
  check("the secret never comes back", !JSON.stringify(saved.json).includes(STAND_IN.clientSecret));
  check("the redirect URI is this copy's", saved.json?.redirectUri === `${APP}/api/auth/google/callback`, saved.json?.redirectUri);

  // ─── Connect ───
  const start = await api("/api/auth/google?connect=true");
  const consent = start.json?.url ?? "";
  check("connect sends the browser to the consent page", consent.startsWith(`http://127.0.0.1:${STAND_IN_PORT}/o/oauth2/v2/auth?`), consent);
  check("asking for the events and the email, nothing wider", new URL(consent).searchParams.get("scope") === "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email");
  const cookie = cookiesFrom(start.headers);
  check("the attempt is held in two cookies", cookie.includes("croncal_google_oauth_state=") && cookie.includes("croncal_google_user_id="), cookie);

  const granted = await fetch(consent, { redirect: "manual" });
  const callback = new URL(granted.headers.get("location"));
  check("Google sends the browser back to the callback", callback.pathname === "/api/auth/google/callback");

  const forged = new URL(callback);
  forged.searchParams.set("state", "someone-elses");
  const refused = await api(`${forged.pathname}${forged.search}`, { cookie });
  check("a callback with another state is refused", refused.headers.get("location")?.endsWith("/calendar?google=expired"), refused.headers.get("location"));
  const tampered = cookie.replace(/croncal_google_user_id=[^;]+/, "croncal_google_user_id=00000000-0000-0000-0000-000000000000.bad");
  const notSigned = await api(`${callback.pathname}${callback.search}`, { cookie: tampered });
  check("a callback with an altered account cookie is refused", notSigned.headers.get("location")?.endsWith("/calendar?google=expired"), notSigned.headers.get("location"));

  // The forged tries spent nothing: the code is still good once.
  const done = await api(`${callback.pathname}${callback.search}`, { cookie });
  check("the real callback connects", done.headers.get("location")?.endsWith("/calendar?google=connected"), done.headers.get("location"));
  check("and clears its cookies", done.headers.getSetCookie().every((line) => /Max-Age=0/.test(line)), done.headers.getSetCookie().join(" | "));
  const replay = await api(`${callback.pathname}${callback.search}`, { cookie });
  check("the same callback twice does not connect twice", replay.headers.get("location")?.includes("google=") && !replay.headers.get("location")?.endsWith("connected"), replay.headers.get("location"));

  status = await api("/api/auth/google/status");
  check("connected, as the Google account", status.json?.connected === true && status.json?.googleEmail === STAND_IN.email, JSON.stringify(status.json));

  // ─── Sync ───
  const day = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  day.setUTCHours(2, 0, 0, 0);
  const at = (offsetHours) => new Date(day.getTime() + offsetHours * 3600 * 1000).toISOString();
  const created = await api("/api/google-calendar/events/create", {
    method: "POST",
    body: { title: "Stand-in review", start_time: at(0), end_time: at(1), all_day: false, timezone: "Asia/Singapore", importance: "high", event_type: "work", location: "Room 4" },
  });
  const googleId = created.json?.googleEventId;
  check("an event is made in Google", created.status === 200 && Boolean(googleId), JSON.stringify(created.json));
  const inGoogle = (await (await fetch(`http://127.0.0.1:${STAND_IN_PORT}/__state`)).json()).events.find((event) => event.id === googleId);
  check("with its place and its importance and type, which Google has no field for", inGoogle?.location === "Room 4" && inGoogle?.extendedProperties?.private?.croncalImportance === "high" && inGoogle?.extendedProperties?.private?.croncalType === "work", JSON.stringify(inGoogle));

  const range = `timeMin=${encodeURIComponent(at(-48))}&timeMax=${encodeURIComponent(at(24 * 21))}`;
  let listed = await api(`/api/google-calendar/events?${range}`);
  const shown = listedEvents(listed).find((event) => event.google_event_id === googleId);
  check("and read back as the calendar shows it", shown?.title === "Stand-in review" && shown?.importance === "high" && shown?.event_type === "work", JSON.stringify(listed.json).slice(0, 400));

  const renamed = await api("/api/google-calendar/events/update", { method: "PUT", body: { googleEventId: googleId, title: "Stand-in review, moved", start_time: at(3), end_time: at(4), all_day: false, timezone: "Asia/Singapore" } });
  check("an edit goes to Google", renamed.status === 200, JSON.stringify(renamed.json));
  listed = await api(`/api/google-calendar/events?${range}`);
  const moved = listedEvents(listed).find((event) => event.google_event_id === googleId);
  check("and reads back changed", moved?.title === "Stand-in review, moved" && moved?.start_time && new Date(moved.start_time).toISOString() === at(3), JSON.stringify(moved));

  const series = await api("/api/google-calendar/events/create", {
    method: "POST",
    body: { title: "Stand-in weekly", start_time: at(6), end_time: at(7), all_day: false, timezone: "Asia/Singapore", repeat: "weekly" },
  });
  check("a weekly event is made in Google as one series", series.status === 200, JSON.stringify(series.json));
  listed = await api(`/api/google-calendar/events?${range}`);
  const weeks = listedEvents(listed).filter((event) => event.title === "Stand-in weekly");
  check("and shows on each week", weeks.length === 3, `${weeks.length} days`);
  const second = weeks[1];
  const dropped = await api("/api/google-calendar/events/delete", { method: "DELETE", body: { googleEventId: second?.google_event_id, scope: "single" } });
  check("one day of it can be deleted", dropped.status === 200, JSON.stringify(dropped.json));
  listed = await api(`/api/google-calendar/events?${range}`);
  check("and only that day goes", listedEvents(listed).filter((event) => event.title === "Stand-in weekly").length === 2);
  const all = await api("/api/google-calendar/events/delete", { method: "DELETE", body: { googleEventId: weeks[0]?.google_event_id, scope: "all" } });
  check("then the whole series", all.status === 200, JSON.stringify(all.json));
  const gone = await api("/api/google-calendar/events/delete", { method: "DELETE", body: { googleEventId: googleId } });
  check("and the one-off", gone.status === 200, JSON.stringify(gone.json));
  listed = await api(`/api/google-calendar/events?${range}`);
  check("leaving the calendar as it was", listedEvents(listed).every((event) => !event.title.startsWith("Stand-in")), JSON.stringify(listedEvents(listed).map((e) => e.title)));
  check("a short-lived token was refreshed rather than failing", log.refreshes > 0, `${log.refreshes} refreshes`);

  // ─── Disconnect ───
  const off = await api("/api/auth/google/disconnect", { method: "POST", body: {} });
  check("disconnect works", off.status === 200, JSON.stringify(off.json));
  check("and revokes the grant at Google", log.revoked.some((value) => value.startsWith("standin-refresh-")), JSON.stringify(log.revoked));
  status = await api("/api/auth/google/status");
  check("then it is disconnected", status.json?.connected === false && status.json?.needsReconnect === false, JSON.stringify(status.json));
} finally {
  const removed = await api("/api/google/client", { method: "PUT", body: { remove: true } }).catch(() => null);
  check("the client is removed again", removed?.json?.saved === false, JSON.stringify(removed?.json));
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`google-e2e: ${failures.length} failed, ${passed} passed`);
  finish(1);
}
console.log(`google-e2e: ${passed} passed`);
finish(0);
