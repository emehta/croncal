/**
 * Cases for which days an event is on: `npm test -- event-days`.
 *
 * What is being defended is an all-day event on the wrong day. One made in
 * Singapore for the 5th starts at 16:00 on the 4th in UTC and 12:00 on the
 * 4th in New York, and placed by those hours it was drawn on the 4th, counted
 * on the 4th and opened as the 4th. It is the 5th everywhere. These run under
 * every zone `npm test` is run in, and must give the same days in each.
 */

import { zonedDateTimeToUtc } from "@/lib/calendar-timezone";
import { countOccurrencesOnDays, countSpans, occurrenceDays, occurrencesByDay } from "@/lib/event-days";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** An all-day event as the form saves it: midnight to 23:59:59 in its own zone. */
function allDay(first, last, timezone, extra = {}) {
  return {
    id: `${timezone}-${first}`, title: "All day", all_day: true, timezone, recurrence: null,
    start_time: zonedDateTimeToUtc(first, "00:00", timezone).toISOString(),
    end_time: zonedDateTimeToUtc(last, "23:59", timezone, 59).toISOString(),
    ...extra,
  };
}
const daysOf = (event) => occurrenceDays(event, new Date(event.start_time), new Date(event.end_time));

for (const zone of ["Asia/Singapore", "Pacific/Kiritimati", "Pacific/Honolulu", "America/New_York", "Europe/London", "Australia/Lord_Howe", "UTC"]) {
  check(`an all-day event made in ${zone} is on its own day`, daysOf(allDay("2026-10-05", "2026-10-05", zone)), { first: "2026-10-05", last: "2026-10-05" });
  check(`…and three days are three days`, daysOf(allDay("2026-10-31", "2026-11-02", zone)), { first: "2026-10-31", last: "2026-11-02" });
}

// From Google, with no offset: its dates as written, read on this device's clock.
check("a Google all-day event is on the dates Google gives", daysOf({ all_day: true, timezone: "Asia/Tokyo", start_time: "2026-10-05T00:00:00", end_time: "2026-10-06T23:59:59" }),
  { first: "2026-10-05", last: "2026-10-06" });

// A timed event on the days it runs through here, and not on the day it ends at midnight.
const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
check("a timed event over midnight is on both days", daysOf({ all_day: false, timezone: "UTC", start_time: local(5, 23), end_time: local(6, 1) }), { first: "2026-10-05", last: "2026-10-06" });
check("one that ends at midnight is on its own day only", daysOf({ all_day: false, timezone: "UTC", start_time: local(5, 22), end_time: local(6, 0) }), { first: "2026-10-05", last: "2026-10-05" });

/* By day, as the grids and the mini calendar ask. */
const farEast = allDay("2026-10-05", "2026-10-05", "Pacific/Kiritimati");
const farWest = allDay("2026-10-05", "2026-10-05", "Pacific/Honolulu");
const series = allDay("2026-10-04", "2026-10-04", "Pacific/Kiritimati", { id: "daily", recurrence: "daily", recurrence_exceptions: [], recurrence_until: null });
const byDay = occurrencesByDay([farEast, farWest, series], "2026-10-05", "2026-10-07");
check("each all-day event on its day, however far east or west it was made",
  [...byDay.entries()].map(([day, list]) => [day, list.map((o) => o.event.id).sort()]),
  [["2026-10-05", ["Pacific/Honolulu-2026-10-05", "Pacific/Kiritimati-2026-10-05", "daily"]], ["2026-10-06", ["daily"]], ["2026-10-07", ["daily"]]]);

/* The sidebar's counts. */
check("today's week from Sunday, and its month", countSpans("2026-10-15", "sunday"),
  { today: { first: "2026-10-15", last: "2026-10-15" }, week: { first: "2026-10-11", last: "2026-10-17" }, month: { first: "2026-10-01", last: "2026-10-31" } });
check("from Monday, a Sunday is its week's last day", countSpans("2026-10-18", "monday").week, { first: "2026-10-12", last: "2026-10-18" });
check("a week that crosses a month", countSpans("2026-10-31", "monday").week, { first: "2026-10-26", last: "2026-11-01" });
const twoDays = allDay("2026-10-14", "2026-10-15", "Asia/Singapore");
check("an event over two days counts once in the week, and on each of its days",
  [countOccurrencesOnDays([twoDays, farEast], "2026-10-11", "2026-10-17"), countOccurrencesOnDays([twoDays], "2026-10-15", "2026-10-15"), countOccurrencesOnDays([twoDays], "2026-10-16", "2026-10-16")],
  [1, 1, 0]);
check("a daily all-day series counts each day of the week", countOccurrencesOnDays([series], "2026-10-11", "2026-10-17"), 7);

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`event-days: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`event-days: ${passed} passed`);
