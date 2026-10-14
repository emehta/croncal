/**
 * Cases for what an event looks like to Google. No framework: `npm test -- google`.
 *
 * What is being defended is a sync that fails without an error: an all-day
 * event read in the server's zone rather than its own lands on the wrong day
 * in Google Calendar, and nothing on either side says so.
 */

import { zonedDateTimeToUtc } from "@/lib/calendar-timezone";
import {
  buildGoogleCreateAttendees,
  googleCreateBody,
  googleEventTiming,
  readGoogleEventCreate,
} from "@/app/api/google-calendar/events/google-payload";
import { createGoogleEvent } from "@/app/api/google-calendar/events/google-edit";
import { googleCreateFields } from "@/lib/google-event-changes";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* The instants the event form sends for an all-day event: local midnight to 23:59:59. */
function allDay(startDate, endDate, timezone) {
  return {
    start_time: zonedDateTimeToUtc(startDate, "00:00", timezone).toISOString(),
    end_time: zonedDateTimeToUtc(endDate, "23:59", timezone, 59).toISOString(),
    all_day: true,
    timezone,
  };
}

// East of UTC: the case that used to start a day early.
check("Singapore, one day", googleEventTiming(allDay("2026-09-26", "2026-09-26", "Asia/Singapore")),
  { start: { date: "2026-09-26" }, end: { date: "2026-09-27" } });
check("Singapore, three days", googleEventTiming(allDay("2026-09-26", "2026-09-28", "Asia/Singapore")),
  { start: { date: "2026-09-26" }, end: { date: "2026-09-29" } });
check("Tokyo, across a month end", googleEventTiming(allDay("2026-09-30", "2026-10-01", "Asia/Tokyo")),
  { start: { date: "2026-09-30" }, end: { date: "2026-10-02" } });
check("Kiritimati, UTC+14", googleEventTiming(allDay("2026-12-31", "2026-12-31", "Pacific/Kiritimati")),
  { start: { date: "2026-12-31" }, end: { date: "2027-01-01" } });
// West of UTC, and a daylight saving change inside the event.
check("New York, one day", googleEventTiming(allDay("2026-09-26", "2026-09-26", "America/New_York")),
  { start: { date: "2026-09-26" }, end: { date: "2026-09-27" } });
check("New York, across the November change", googleEventTiming(allDay("2026-10-31", "2026-11-02", "America/New_York")),
  { start: { date: "2026-10-31" }, end: { date: "2026-11-03" } });
check("Honolulu, UTC-10", googleEventTiming(allDay("2026-09-26", "2026-09-26", "Pacific/Honolulu")),
  { start: { date: "2026-09-26" }, end: { date: "2026-09-27" } });
check("UTC itself", googleEventTiming(allDay("2026-02-28", "2026-02-28", "UTC")),
  { start: { date: "2026-02-28" }, end: { date: "2026-03-01" } });

// Timed events pass through with their zone.
check("timed event", googleEventTiming({ start_time: "2026-09-26T01:00:00.000Z", end_time: "2026-09-26T02:00:00.000Z", all_day: false, timezone: "Asia/Singapore" }),
  { start: { dateTime: "2026-09-26T01:00:00.000Z", timeZone: "Asia/Singapore" }, end: { dateTime: "2026-09-26T02:00:00.000Z", timeZone: "Asia/Singapore" } });
check("timed event with no zone takes UTC, never a city's", googleEventTiming({ start_time: "2026-09-26T01:00:00.000Z", end_time: "2026-09-26T02:00:00.000Z", all_day: false }).start.timeZone, "UTC");

// Anything unusable is refused rather than sent as NaN dates.
check("missing start", googleEventTiming({ end_time: "2026-09-26T02:00:00.000Z", all_day: false }), null);
check("unparseable start", googleEventTiming({ start_time: "tomorrow", end_time: "2026-09-26T02:00:00.000Z", all_day: false }), null);
check("all_day not a boolean", googleEventTiming({ start_time: "2026-09-26T01:00:00.000Z", end_time: "2026-09-26T02:00:00.000Z", all_day: "yes" }), null);
check("end before start", googleEventTiming({ start_time: "2026-09-26T03:00:00.000Z", end_time: "2026-09-26T02:00:00.000Z", all_day: false }), null);
check("numbers are not times", googleEventTiming({ start_time: 1, end_time: 2, all_day: false }), null);

// Attendees, which the create route builds alongside.
check("attendees from names and emails", buildGoogleCreateAttendees("Ann <ann@x.com>, bob@y.com, not an email"),
  [{ displayName: "Ann", email: "ann@x.com" }, { email: "bob@y.com" }]);
check("no attendees", buildGoogleCreateAttendees(""), undefined);

/* ── a new event, as Google is sent it ─────────────────────────────────── */

/*
 * The failure here was quiet too. An event added in CronCal reached Google as
 * its title, times and colour alone: a weekly event arrived as one day, and
 * its type, importance and link were never there.
 */

// The owner's real case, 5 Oct 2026: 17:15 to 17:58 in Singapore, Basil, Personal, Medium.
const meeting = {
  title: "Meet the team",
  description: "Poolside",
  location: null,
  participants: null,
  start_time: "2026-10-05T09:15:00.000Z",
  end_time: "2026-10-05T09:58:00.000Z",
  all_day: false,
  timezone: "Asia/Singapore",
  color: "#0B8043",
  importance: "medium",
  event_type: "personal",
  link: null,
  repeat: "none",
};
check("everything the form holds goes to Google", googleCreateBody(meeting), {
  summary: "Meet the team",
  start: { dateTime: "2026-10-05T09:15:00.000Z", timeZone: "Asia/Singapore" },
  end: { dateTime: "2026-10-05T09:58:00.000Z", timeZone: "Asia/Singapore" },
  description: "Poolside",
  colorId: "10",
  extendedProperties: { private: { croncalImportance: "medium", croncalType: "personal" } },
});
check("…with no rule for an event that does not repeat", "recurrence" in googleCreateBody(meeting), false);

check("a weekly event repeats on its own weekday, from its first day",
  googleCreateBody({ ...meeting, repeat: "weekly" }).recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
check("…its weekday where the event is, not where the server is: 07:30 Tuesday in Singapore is Monday in UTC",
  googleCreateBody({ ...meeting, start_time: "2026-10-05T23:30:00.000Z", end_time: "2026-10-06T00:30:00.000Z", repeat: "weekly" }).recurrence,
  ["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
check("every weekday", googleCreateBody({ ...meeting, repeat: "weekdays" }).recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]);
check("every two weeks", googleCreateBody({ ...meeting, repeat: "biweekly" }).recurrence, ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"]);
check("every day", googleCreateBody({ ...meeting, repeat: "daily" }).recurrence, ["RRULE:FREQ=DAILY"]);

const allDayCreate = googleCreateBody({ ...meeting, ...allDay("2026-10-05", "2026-10-06", "Asia/Singapore"), repeat: "yearly" });
check("an all-day event is its own two days, end exclusive", [allDayCreate.start, allDayCreate.end],
  [{ date: "2026-10-05" }, { date: "2026-10-07" }]);
check("…and repeats from its own first day", allDayCreate.recurrence, ["RRULE:FREQ=YEARLY"]);

check("the link goes in the private properties, trimmed",
  googleCreateBody({ ...meeting, importance: null, event_type: null, link: "  https://meet.example/abc  " }).extendedProperties,
  { private: { croncalLink: "https://meet.example/abc" } });
check("nothing set means no private properties at all",
  "extendedProperties" in googleCreateBody({ ...meeting, importance: null, event_type: null }), false);
const sparse = googleCreateBody({ ...meeting, description: "   ", location: "", color: "#4a9f6e" });
check("an empty description or location is left out, and a colour Google lacks is not sent",
  ["description" in sparse, "location" in sparse, "colorId" in sparse], [false, false, false]);
check("a location and attendees go as Google spells them",
  (({ location, attendees }) => ({ location, attendees }))(googleCreateBody({ ...meeting, location: " Pool deck ", participants: "Sam <sam@example.com>" })),
  { location: "Pool deck", attendees: [{ displayName: "Sam", email: "sam@example.com" }] });
check("a blank title is still an event", googleCreateBody({ ...meeting, title: "  " }).summary, "(No title)");
check("unusable times are refused", googleCreateBody({ ...meeting, end_time: "2026-10-05T09:00:00.000Z" }), null);

/* The request body, checked rather than trusted. */
const request = { ...meeting, repeat: "weekly", link: "https://x.example" };
const sortedKeys = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
check("a request from the form reads back as itself", sortedKeys(readGoogleEventCreate(request)), sortedKeys(request));
check("absent optional fields read as empty", readGoogleEventCreate({ title: "A", start_time: meeting.start_time, end_time: meeting.end_time, all_day: false }),
  { title: "A", start_time: meeting.start_time, end_time: meeting.end_time, all_day: false, timezone: "UTC",
    description: undefined, location: undefined, participants: undefined, link: undefined, color: undefined,
    importance: null, event_type: null, repeat: "none" });
check("no title is refused", typeof readGoogleEventCreate({ ...meeting, title: undefined }), "string");
check("times that are not strings are refused", typeof readGoogleEventCreate({ ...meeting, start_time: 1 }), "string");
check("a repeat the form does not offer is refused", typeof readGoogleEventCreate({ ...meeting, repeat: "hourly" }), "string");
check("an importance outside the three is refused", typeof readGoogleEventCreate({ ...meeting, importance: "urgent" }), "string");
check("a type outside the five is refused", typeof readGoogleEventCreate({ ...meeting, event_type: "party" }), "string");

/* What the form saves, mapped to that shape. */
const saved = {
  title: "Gym", description: null, start_time: meeting.start_time, end_time: meeting.end_time, all_day: false,
  timezone: "Asia/Singapore", recurrence: "weekdays", participants: null, conferencing: "https://zoom.example/1",
  meeting_notes: "not for Google", location: null, color: "#33B679", importance: "high", event_type: "work", sync_to_google: true,
};
check("the form's Link and repeat become Google's link and rule", googleCreateFields(saved), {
  title: "Gym", description: null, location: null, participants: null, start_time: meeting.start_time, end_time: meeting.end_time,
  all_day: false, timezone: "Asia/Singapore", color: "#33B679", importance: "high", event_type: "work",
  link: "https://zoom.example/1", repeat: "weekdays",
});
check("an event with no rule is sent as not repeating", googleCreateFields({ ...saved, recurrence: null }).repeat, "none");

/* ── the create call, against a stubbed Google ─────────────────────────── */

function stubGoogle(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = answers.shift();
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  };
  return { calls, context: { accessToken: "test", fetchImpl } };
}

{
  const google = stubGoogle([[200, { id: "PLACEHOLDER", summary: "Meet the team" }]]);
  const created = await createGoogleEvent(google.context, googleCreateBody(meeting));
  const sent = google.calls[0];
  check("the event is posted once, to the primary calendar", [google.calls.length, sent.method, sent.url],
    [1, "POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events"]);
  check("…with an id of CronCal's own, in characters Google accepts", /^[0-9a-v]{32}$/.test(sent.body.id), true);
  check("…and Google's answer is what comes back", created.summary, "Meet the team");
}

{
  // Google fails after making the event; the retry finds it rather than making a second.
  const google = stubGoogle([[503, { error: { errors: [{ reason: "backendError" }] } }], [409, { error: { code: 409 } }], [200, { id: "x", summary: "Meet the team" }]]);
  const created = await createGoogleEvent(google.context, googleCreateBody(meeting));
  check("a retry after a 503 posts the same id again", google.calls[0].body.id === google.calls[1].body.id, true);
  check("…and a 409 for it reads the event that was made, instead of adding another",
    [google.calls.map((c) => c.method), google.calls[2].url.endsWith(`/${google.calls[0].body.id}`), created.summary],
    [["POST", "POST", "GET"], true, "Meet the team"]);
}

async function refusal(status, reason) {
  const google = stubGoogle([[status, { error: { errors: [{ reason }] } }]]);
  try {
    await createGoogleEvent(google.context, googleCreateBody(meeting));
    return "no error";
  } catch (error) {
    return [error.status, error.message];
  }
}
check("a dead grant says to reconnect", await refusal(401, "authError"), [401, "Reconnect Google Calendar in Settings to restore access."]);
check("a refusal says Google would not let CronCal add it, not that someone else organises it",
  await refusal(403, "insufficientPermissions"), [403, "Google Calendar did not let CronCal add the event. Reconnect it in Settings."]);
check("any other failure says the event was not added", await refusal(400, "invalid"), [502, "Google Calendar could not add the event. Try again in a moment."]);

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`google payload: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`google payload: ${passed} passed`);
