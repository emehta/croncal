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
  buildGoogleUpdateAttendees,
  googleCreateBody,
  googleEventTiming,
  readGoogleEventChanges,
  readGoogleEventCreate,
  readGuestList,
} from "@/app/api/google-calendar/events/google-payload";
import { createGoogleEvent, editGoogleEvent, splitSeriesId } from "@/app/api/google-calendar/events/google-edit";
import { googleCreateFields } from "@/lib/google-event-changes";

const failures = [];
let passed = 0;
const meetingTimes = { start: "2026-10-05T09:15:00.000Z", end: "2026-10-05T09:58:00.000Z" };
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
  [{ email: "ann@x.com", displayName: "Ann" }, { email: "bob@y.com" }]);
check("no attendees", buildGoogleCreateAttendees(""), undefined);

/*
 * A save that changes the guests. Google replaces the whole list with what it
 * is sent, so a guest already there must go back as Google had them: their
 * answer and whether they are optional, not just their address. And a name
 * can hold a comma ("Lee, Ann"), which must not split one guest into two.
 */
const guests = [
  { email: "ann@x.com", displayName: "Lee, Ann", responseStatus: "accepted", optional: true },
  { email: "bob@y.com", responseStatus: "declined" },
  { email: "room@r.com", displayName: "Room 1", resource: true },
];
check("the guests as the form shows them come back as Google had them, a new one added",
  buildGoogleUpdateAttendees("Lee, Ann, bob@y.com, Room 1, new@z.com", guests),
  [...guests, { email: "new@z.com" }]);
check("a guest left out is removed, the rest keep their answers",
  buildGoogleUpdateAttendees("Lee, Ann", guests), [guests[0]]);
check("matched by address whatever its case, and once each",
  buildGoogleUpdateAttendees("BOB@y.com, bob@y.com", guests), [guests[1]]);
check("a new name with a comma in it is one guest",
  readGuestList("Doe, John <john@x.com>, \"Smith, Jo\" <jo@x.com>"),
  [{ email: "john@x.com", displayName: "Doe, John" }, { email: "jo@x.com", displayName: "Smith, Jo" }]);
check("a name typed for a guest already there is taken, with their answer kept",
  buildGoogleUpdateAttendees("Ann Lee <ann@x.com>", guests), [{ ...guests[0], displayName: "Ann Lee" }]);
check("emptied, the guests go", buildGoogleUpdateAttendees("", guests), []);
check("a line that names nobody leaves them as they are", buildGoogleUpdateAttendees("someone", guests), undefined);

/* A change request, checked as a new event is. */
check("a change reads back as itself", readGoogleEventChanges({ title: "A", importance: null, repeat: "weekly", link: null }),
  { title: "A", link: null, importance: null, repeat: "weekly" });
check("only the keys sent", readGoogleEventChanges({ googleEventId: "x", scope: "all", color: "#D50000" }), { color: "#D50000" });
check("times go together, all four", readGoogleEventChanges({ start_time: meetingTimes.start, end_time: meetingTimes.end, all_day: false, timezone: "Asia/Singapore" }),
  { start_time: meetingTimes.start, end_time: meetingTimes.end, all_day: false, timezone: "Asia/Singapore" });
check("a start without the rest is refused", typeof readGoogleEventChanges({ start_time: meetingTimes.start }), "string");
check("an end before the start is refused", typeof readGoogleEventChanges({ start_time: meetingTimes.end, end_time: meetingTimes.start, all_day: false, timezone: "UTC" }), "string");
check("a title that is not text is refused", typeof readGoogleEventChanges({ title: 5 }), "string");
check("a priority outside the three is refused, said as priority", readGoogleEventChanges({ importance: "urgent" }), "Priority must be low, medium or high.");
check("a repeat the form does not offer is refused", typeof readGoogleEventChanges({ repeat: "hourly" }), "string");

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
  { location: "Pool deck", attendees: [{ email: "sam@example.com", displayName: "Sam" }] });
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
check("a dead grant says to reconnect", await refusal(401, "authError"), [401, "Reconnect Google Calendar in Settings."]);
check("a refusal says Google would not let CronCal add it, not that someone else organises it",
  await refusal(403, "insufficientPermissions"), [403, "Google Calendar did not let CronCal add the event. Reconnect it in Settings."]);
check("any other failure says the event was not added", await refusal(400, "invalid"), [502, "Google Calendar could not add the event. Try again in a moment."]);

/* ── a series split from one day on, and its changed days put back ───────── */

/*
 * A stand-in for Google that answers by what is asked, not in a fixed order:
 * a weekly series from Monday 5 Oct, 09:00 in Singapore, with two days
 * changed on their own after the 19th.
 */
function seriesGoogle({ postAnswers = [[200]], refusePatchOf = [] } = {}) {
  const calls = [];
  const series = {
    id: "series1", iCalUID: "series1@google.com", etag: "\"e1\"", status: "confirmed", summary: "Gym",
    organizer: { self: true }, eventType: "default", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    start: { dateTime: "2026-10-05T01:00:00.000Z", timeZone: "Asia/Singapore" },
    end: { dateTime: "2026-10-05T02:00:00.000Z", timeZone: "Asia/Singapore" },
  };
  const day = (date, extra = {}) => ({
    ...series, id: `series1_${date.replaceAll("-", "")}T010000Z`, recurrence: undefined, recurringEventId: "series1",
    originalStartTime: { dateTime: `${date}T01:00:00.000Z`, timeZone: "Asia/Singapore" },
    start: { dateTime: `${date}T01:00:00.000Z`, timeZone: "Asia/Singapore" },
    end: { dateTime: `${date}T02:00:00.000Z`, timeZone: "Asia/Singapore" }, ...extra,
  });
  const changed = [day("2026-10-26", { location: "Pool" }), day("2026-11-02", { location: "Park" })];
  const fetchImpl = async (url, init) => {
    const path = new URL(String(url)).pathname.replace("/calendar/v3/calendars/primary/events", "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    const answer = (status, value) => new Response(value === undefined ? "" : JSON.stringify(value), { status });
    if (init.method === "GET" && path === "/series1") return answer(200, series);
    if (init.method === "GET" && path === "/series1_20261019T010000Z") return answer(200, day("2026-10-19"));
    if (init.method === "GET" && path === "") return answer(200, { items: changed });
    if (init.method === "POST") {
      const [status, value] = postAnswers.shift() ?? [200];
      return answer(status, status === 200 ? { ...body, id: body.id } : value ?? { error: { errors: [{ reason: status === 409 ? "duplicate" : "backendError" }] } });
    }
    if (init.method === "PATCH" && refusePatchOf.some((id) => path.includes(id))) {
      return answer(400, { error: { errors: [{ reason: "invalid" }] } });
    }
    return answer(200, { ...(body ?? {}), id: path.slice(1) });
  };
  return { calls, context: { accessToken: "test", fetchImpl } };
}

const pivotMs = Date.parse("2026-10-19T01:00:00.000Z");
check("a split's new series has an id of its own, the same for the same split",
  [splitSeriesId({ id: "series1", etag: "a" }, pivotMs) === splitSeriesId({ id: "series1", etag: "a" }, pivotMs), /^[0-9a-v]{32}$/.test(splitSeriesId({ id: "series1", etag: "a" }, pivotMs))], [true, true]);
check("…and another once the series has changed, or for another day",
  [splitSeriesId({ id: "series1", etag: "a" }, pivotMs) === splitSeriesId({ id: "series1", etag: "b" }, pivotMs),
    splitSeriesId({ id: "series1", etag: "a" }, pivotMs) === splitSeriesId({ id: "series1", etag: "a" }, pivotMs + 7 * 86_400_000)], [false, false]);

{
  // Google makes the new series but answers 503; the retry is told it exists (409), and makes it this split's instead of adding a second.
  const google = seriesGoogle({ postAnswers: [[503], [409]] });
  const result = await editGoogleEvent(google.context, "series1_20261019T010000Z", "following", { title: "Gym, new" });
  const posts = google.calls.filter((c) => c.method === "POST");
  const put = google.calls.find((c) => c.method === "PUT");
  check("a split retried after Google failed posts the same id again", posts.length === 2 && posts[0].body.id === posts[1].body.id && posts[0].body.id === splitSeriesId({ id: "series1", etag: "\"e1\"" }, pivotMs), true);
  check("…and a 409 for it writes this split onto the one Google made", [put?.path, put?.body.status, put?.body.summary], [`/${posts[0].body.id}`, "confirmed", "Gym, new"]);
  check("…then ends the old series and puts the changed days back on the new one",
    [google.calls.some((c) => c.method === "PATCH" && c.path === "/series1" && /UNTIL=/.test(c.body.recurrence[0])), google.calls.filter((c) => c.method === "PATCH" && c.path.startsWith(`/${posts[0].body.id}_`)).length, result.notCarried],
    [true, 2, 0]);
}

{
  // Google refuses one changed day: it is counted, the next is still put back, and the save stands.
  const google = seriesGoogle({ refusePatchOf: ["20261026"] });
  let outcome;
  try { outcome = await editGoogleEvent(google.context, "series1_20261019T010000Z", "following", { title: "Gym, new" }); } catch (error) { outcome = String(error); }
  check("a changed day Google refuses is counted, and the save does not fail", outcome, { notCarried: 1 });
  check("…and the day after it is still put back", google.calls.some((c) => c.method === "PATCH" && c.path.endsWith("_20261102T010000Z")), true);
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`google payload: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`google payload: ${passed} passed`);
