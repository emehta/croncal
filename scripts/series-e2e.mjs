#!/usr/bin/env node
/**
 * Changing a CronCal series, against a real Supabase test project: the
 * saves the calendar page makes (src/lib/calendar-events.ts), then the days
 * the calendar would show, read back as it reads them.
 *
 *   CRONCAL_E2E_DATA_DIR=<folder with a test project's config.json> \
 *   CRONCAL_E2E_EMAIL=<owner> CRONCAL_E2E_PASSWORD=<password> \
 *   node --import ./scripts/alias-loader.mjs scripts/series-e2e.mjs
 *
 * Not part of `npm test`: it writes to the project, and deletes what it made.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const DATA = process.env.CRONCAL_E2E_DATA_DIR;
const EMAIL = process.env.CRONCAL_E2E_EMAIL;
const PASSWORD = process.env.CRONCAL_E2E_PASSWORD;
if (!DATA || !EMAIL || !PASSWORD) {
  console.error("Set CRONCAL_E2E_DATA_DIR, CRONCAL_E2E_EMAIL and CRONCAL_E2E_PASSWORD.");
  process.exit(1);
}

const config = JSON.parse(readFileSync(path.join(DATA, "config.json"), "utf8"));
const { configureSupabase, supabase } = await import("@/lib/supabase");
configureSupabase({ url: config.url, publishableKey: config.publishableKey });
const { error: signInError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInError) {
  console.error(`series-e2e: could not sign in: ${signInError.message}`);
  process.exit(1);
}
const events = await import("@/lib/calendar-events");
const { getAllOccurrencesInRange } = await import("@/lib/calendar-occurrence-utils");

const failures = [];
let passed = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
};

const ZONE = "Asia/Singapore";
const TAG = `series-e2e ${Date.now()}`;
// Five Mondays at 09:00 Singapore time, 01:00 UTC.
const week = (n, hour = 1) => new Date(Date.UTC(2031, 0, 6 + 7 * n, hour)).toISOString();
const range = [new Date(Date.UTC(2031, 0, 1)), new Date(Date.UTC(2031, 2, 1))];

/** What the calendar shows for the test's events: each day's title and start. */
async function shown() {
  const rows = (await events.fetchCalendarEvents(range[0].toISOString(), range[1].toISOString())).filter((row) => row.title.startsWith(TAG));
  return getAllOccurrencesInRange(rows, range[0], range[1]).map((day) => `${day.event.title.slice(TAG.length + 1) || "-"} ${day.start.toISOString().slice(5, 16)}`);
}

async function cleanUp() {
  await supabase.from("calendar_events").delete().like("title", `${TAG}%`).not("recurrence_parent_id", "is", null);
  await supabase.from("calendar_events").delete().like("title", `${TAG}%`);
}

const base = {
  title: `${TAG} weekly`, description: null, start_time: week(0), end_time: week(0, 2), all_day: false, timezone: ZONE,
  recurrence: "weekly", recurrence_until: null, recurrence_exceptions: [], recurrence_parent_id: null, original_occurrence_start: null,
  participants: null, conferencing: null, meeting_notes: null, location: null, color: "#039BE5", importance: null, event_type: null,
  google_event_id: null, sync_to_google: false,
};
const day = (n) => ({ start: new Date(week(n)), end: new Date(week(n, 2)) });

try {
  // Five weeks, then week 3 moved to 15:00 on its own and week 2 deleted.
  let { event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(4, 23) });
  await events.applyRecurringOccurrenceEdit(series, day(3), { ...base, title: `${TAG} moved`, start_time: week(3, 7), end_time: week(3, 8), recurrence: null });
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  await events.deleteRecurringOccurrence(series, day(2));
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  check("before: five weeks, one moved, one gone", await shown(), ["weekly 01-06T01:00", "weekly 01-13T01:00", "moved 01-27T07:00", "weekly 02-03T01:00"]);

  // From week 1, renamed and an hour later: the moved day keeps its own change, the deleted one stays gone.
  await events.applyRecurringFollowingEdit(series, day(1), { ...base, title: `${TAG} later`, start_time: week(1, 2), end_time: week(1, 3), recurrence_until: week(4, 23) });
  check("this and following keeps a day changed on its own, and a day deleted stays deleted", await shown(), ["weekly 01-06T01:00", "later 01-13T02:00", "moved 01-27T07:00", "later 02-03T02:00"]);

  // From the first day: no empty series is left behind.
  await cleanUp();
  ({ event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(2, 23) }));
  await events.applyRecurringFollowingEdit(series, day(0), { ...base, title: `${TAG} all`, recurrence_until: week(2, 23) });
  const { data: left } = await supabase.from("calendar_events").select("id, title").like("title", `${TAG}%`);
  check("from the first day, one series is left, not an empty one beside it", left?.map((row) => row.title.slice(TAG.length + 1)), ["all"]);
  check("with every day", await shown(), ["all 01-06T01:00", "all 01-13T01:00", "all 01-20T01:00"]);

  // All days a week later, with two days in a row changed on their own: each takes the next one's place.
  await cleanUp();
  ({ event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(4, 23) }));
  for (const [n, name] of [[1, "a"], [2, "b"]]) {
    await events.applyRecurringOccurrenceEdit(series, day(n), { ...base, title: `${TAG} ${name}`, start_time: week(n, 7), end_time: week(n, 8), recurrence: null });
    ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  }
  await events.applyRecurringSeriesEdit(series, day(0), { ...base, start_time: week(1), end_time: week(1, 2), recurrence_until: week(5, 23) }, { ...series, start_time: week(0), end_time: week(0, 2) });
  check("all days moved a week, the changed days with them", await shown(), ["weekly 01-13T01:00", "a 01-20T07:00", "b 01-27T07:00", "weekly 02-03T01:00", "weekly 02-10T01:00"]);

  // From week 2, "Does not repeat": the series ends there, and week 2 is one event of its own.
  await cleanUp();
  ({ event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(4, 23) }));
  await events.applyRecurringOccurrenceEdit(series, day(3), { ...base, title: `${TAG} moved`, start_time: week(3, 7), end_time: week(3, 8), recurrence: null });
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  await events.applyRecurringFollowingEdit(series, day(2), { ...base, title: `${TAG} once`, start_time: week(2), end_time: week(2, 2), recurrence: null });
  check("Does not repeat from a day ends the series there, and the days after it go", await shown(), ["weekly 01-06T01:00", "weekly 01-13T01:00", "once 01-20T01:00"]);

  // From week 1, a day later: the skipped and changed days after it move a day too, as for all days.
  await cleanUp();
  ({ event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(5, 23) }));
  await events.deleteRecurringOccurrence(series, day(2));
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  await events.applyRecurringOccurrenceEdit(series, day(3), { ...base, title: `${TAG} moved`, start_time: week(3, 7), end_time: week(3, 8), recurrence: null });
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  const tuesday = (n, hour = 1) => new Date(new Date(week(n, hour)).getTime() + 86_400_000).toISOString();
  const split = crypto.randomUUID();
  const following = { ...base, start_time: tuesday(1), end_time: tuesday(1, 2), recurrence_until: week(5, 23) };
  await events.applyRecurringFollowingEdit(series, day(1), following, undefined, split);
  // The same save sent again, as after an answer lost on its way back: nothing more changes.
  await events.applyRecurringFollowingEdit(series, day(1), following, undefined, split);
  check("this and following a day later moves its skipped and changed days with it, and sent twice makes one series",
    await shown(), ["weekly 01-06T01:00", "weekly 01-14T01:00", "moved 01-28T07:00", "weekly 02-04T01:00"]);

  // Deleting from the first day deletes the whole series, its changed days too.
  await cleanUp();
  ({ event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(4, 23) }));
  await events.applyRecurringOccurrenceEdit(series, day(2), { ...base, title: `${TAG} moved`, start_time: week(2, 7), end_time: week(2, 8), recurrence: null });
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  await events.deleteRecurringFollowing(series, day(0));
  const { data: gone } = await supabase.from("calendar_events").select("id").like("title", `${TAG}%`);
  check("deleting this and following from the first day deletes the whole series", gone?.length, 0);

  // A changed day is still a day of its series: renamed for all days from it, the series is renamed and it keeps its own time.
  await cleanUp();
  ({ event: series } = await events.createCalendarEvent({ ...base, recurrence_until: week(2, 23) }));
  await events.applyRecurringOccurrenceEdit(series, day(1), { ...base, start_time: week(1, 7), end_time: week(1, 8), recurrence: null });
  ({ data: series } = await supabase.from("calendar_events").select("*").eq("id", series.id).single());
  const { data: changedDay } = await supabase.from("calendar_events").select("*").eq("recurrence_parent_id", series.id).single();
  const shownChanged = { ...changedDay, recurrence: series.recurrence };
  await events.applyRecurringSeriesEdit(series, day(1), { ...shownChanged, title: `${TAG} renamed` }, shownChanged);
  check("all days renamed from a day changed on its own", await shown(), ["renamed 01-06T01:00", "renamed 01-13T07:00", "renamed 01-20T01:00"]);
} finally {
  await cleanUp();
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`series-e2e: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`series-e2e: ${passed} passed`);
