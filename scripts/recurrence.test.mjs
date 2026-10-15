/**
 * Cases for recurrence expansion. No framework: `npm test -- recurrence`.
 *
 * This exists because of one bug that nothing on screen would have explained.
 * The cursor started at the event's own start time and stepped one interval at
 * a time until it reached the window being drawn, against a 1000-iteration
 * cap, so a *daily* event older than 1000 days spent the whole budget
 * travelling and returned nothing. The event did not render late or partly; it
 * was simply not on the calendar, and the only trace was a console warning
 * saying "may be truncated".
 *
 * So the cases below are mostly about reach: an old event still appears, and
 * appears in full. The rest pin the parts that were easy to break while fixing
 * that: month-end clamping, the weekend skip, DST, and the fact that an
 * occurrence starting before the window still counts if it runs into it.
 */

import { expandRecurrences, nextRepeatDays } from "@/lib/recurrence";

const NY = "America/New_York";

function event(overrides) {
  const start = new Date(overrides.start ?? "2019-01-15T14:30:00.000Z");
  const hours = overrides.hours ?? 1;
  return {
    id: "test-event",
    title: "Test",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + hours * 3_600_000).toISOString(),
    timezone: overrides.timezone ?? NY,
    recurrence: overrides.recurrence,
    recurrence_until: overrides.until ?? null,
    recurrence_exceptions: overrides.exceptions ?? [],
  };
}

function expand(overrides, rangeStart, rangeEnd) {
  return expandRecurrences(event(overrides), new Date(rangeStart), new Date(rangeEnd));
}

const failures = [];
let passed = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    return;
  }
  failures.push(`  ${name}\n      got ${actual}\n     want ${expected}`);
}

/* ── reach: an old event is still on the calendar ───────────────────────── */

// 2019 → 2026 is ~2800 days, nearly three times the old iteration cap.
check(
  "daily event from 2019 fills a 2026 month",
  expand({ recurrence: "daily" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  30,
);
check(
  "daily event from 2019 fills a 2026 week",
  expand({ recurrence: "daily" }, "2026-09-21T00:00:00Z", "2026-09-28T00:00:00Z").length,
  7,
);
// The seed is a Tuesday, and September 2026 has five of them (1, 8, 15, 22, 29).
check(
  "weekly event from 2019 fills a 2026 month",
  expand({ recurrence: "weekly" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  5,
);
// 2786 days from the seed to 1 Sep 2026, which is a whole number of
// fortnights, so the series lands on the 1st, 15th and 29th.
check(
  "biweekly event from 2019 keeps its phase across seven years",
  expand({ recurrence: "biweekly" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  3,
);
// September 2026 has 22 weekdays.
check(
  "weekdays event from 2019 skips the weekends of a 2026 month",
  expand({ recurrence: "weekdays" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  22,
);
check(
  "monthly event from 2019 appears once in a 2026 month",
  expand({ recurrence: "monthly" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  1,
);
check(
  "yearly event from 2019 appears once in its 2026 month",
  expand({ recurrence: "yearly" }, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z").length,
  1,
);
check(
  "yearly event does not appear in another month",
  expand({ recurrence: "yearly" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  0,
);

/* ── the window itself ──────────────────────────────────────────────────── */

check(
  "an event that starts after the window is not expanded into it",
  expand({ recurrence: "daily", start: "2030-01-01T10:00:00Z" }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  0,
);
// A 30-hour occurrence beginning the day before still overlaps the window.
check(
  "a long occurrence starting before the window still counts",
  expand({ recurrence: "daily", hours: 30 }, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").length,
  31,
);
check(
  "recurrence_until stops the series",
  expand(
    { recurrence: "daily", until: "2026-09-10T00:00:00Z" },
    "2026-09-01T00:00:00Z",
    "2026-10-01T00:00:00Z",
  ).length,
  9,
);
check(
  "an exception removes exactly its own occurrence",
  expand(
    { recurrence: "daily", start: "2026-09-01T14:30:00.000Z", exceptions: ["2026-09-03T14:30:00.000Z"] },
    "2026-09-01T00:00:00Z",
    "2026-10-01T00:00:00Z",
  ).length,
  29,
);

/* ── clocks and calendars ───────────────────────────────────────────────── */

/*
 * A monthly event seeded on the 31st. February has no 31st, so it clamps to
 * the last day, and clamping must happen from the seed each time, not from
 * wherever the previous month landed, or the series walks backwards to the
 * 28th and stays there.
 */
const monthEnd = expand(
  { recurrence: "monthly", start: "2026-01-31T15:00:00.000Z" },
  "2026-01-01T00:00:00Z",
  "2026-05-01T00:00:00Z",
);
check("a monthly event on the 31st recurs four times Jan–Apr", monthEnd.length, 4);
check(
  "…clamping to February does not drag March off the 31st",
  monthEnd.map((o) => o.start.toISOString().slice(0, 10)).join(","),
  "2026-01-31,2026-02-28,2026-03-31,2026-04-30",
);

/*
 * US clocks go forward at 02:00 on Sunday 8 March 2026. A daily 09:00 event
 * stays at 09:00 local across it, which is a different UTC instant on either
 * side: 14:00Z on the 6th and 7th, 13:00Z from the 8th on.
 */
const dst = expand(
  { recurrence: "daily", start: "2026-03-06T14:00:00.000Z" },
  "2026-03-06T00:00:00Z",
  "2026-03-11T00:00:00Z",
);
check(
  "a daily event holds its local time across a DST change",
  dst.map((o) => o.start.toISOString().slice(11, 16)).join(","),
  "14:00,14:00,13:00,13:00,13:00",
);
check(
  "the same event in a fixed-offset zone does not shift",
  expand(
    { recurrence: "daily", start: "2026-03-06T14:00:00.000Z", timezone: "Asia/Singapore" },
    "2026-03-06T00:00:00Z",
    "2026-03-11T00:00:00Z",
  )
    .map((o) => o.start.toISOString().slice(11, 16))
    .join(","),
  "14:00,14:00,14:00,14:00,14:00",
);

/* The form's "Next:" line: the days the calendar will draw, or Google's where the event goes to Google. */
check("next days, monthly on the 31st in CronCal", nextRepeatDays("monthly", "2027-01-31", false).join(","), "2027-02-28,2027-03-31,2027-04-30");
check("next days, monthly on the 31st in Google, which skips short months", nextRepeatDays("monthly", "2027-01-31", true).join(","), "2027-03-31,2027-05-31,2027-07-31");
check("next days, yearly on 29 February in CronCal", nextRepeatDays("yearly", "2028-02-29", false).join(","), "2029-02-28,2030-02-28,2031-02-28");
check("next days, yearly on 29 February in Google", nextRepeatDays("yearly", "2028-02-29", true).join(","), "2032-02-29,2036-02-29,2040-02-29");
check("next days, every 2 weeks finds three", nextRepeatDays("biweekly", "2026-10-16", false).join(","), "2026-10-30,2026-11-13,2026-11-27");
check("next days, weekdays from a Friday", nextRepeatDays("weekdays", "2026-10-16", true).join(","), "2026-10-19,2026-10-20,2026-10-21");

/*
 * An all-day day runs from midnight to 23:59:59 on the clock, so on the day
 * the clocks change it is an hour shorter or longer than the series' first.
 * Measured in hours instead, the day after the change ran an hour into the
 * next (01:59:59 on 9 March in New York) and was drawn on two days.
 */
const allDayNy = {
  ...event({ recurrence: "daily", start: "2026-03-06T05:00:00.000Z" }),
  end_time: "2026-03-07T04:59:59.000Z",
  all_day: true,
};
const allDays = expandRecurrences(allDayNy, new Date("2026-03-06T00:00:00Z"), new Date("2026-03-11T00:00:00Z"));
check(
  "an all-day day ends at 23:59:59 on its own day across the March change",
  allDays.map((o) => `${o.start.toISOString().slice(5, 16)}>${o.end.toISOString().slice(5, 16)}`).join(","),
  "03-06T05:00>03-07T04:59,03-07T05:00>03-08T04:59,03-08T05:00>03-09T03:59,03-09T04:00>03-10T03:59,03-10T04:00>03-11T03:59",
);
// And a timed day keeps its clock times at both ends, not its length in hours.
const lateNight = expandRecurrences(
  { ...event({ recurrence: "daily", start: "2026-10-30T04:30:00.000Z", hours: 2 }) },
  new Date("2026-10-30T00:00:00Z"),
  new Date("2026-11-03T00:00:00Z"),
);
check(
  "a 00:30 to 02:30 day in New York is 00:30 to 02:30 on the night the clocks go back",
  lateNight.map((o) => new Date(o.end.getTime()).toLocaleTimeString("en-GB", { timeZone: NY, hour: "2-digit", minute: "2-digit" })).join(","),
  "02:30,02:30,02:30,02:30",
);

/*
 * 02:30 does not happen in New York on 8 March 2026: the clocks jump from
 * 02:00 to 03:00. A daily 02:30 event is at 03:30 that day, later, as the
 * clocks went, never at 01:30.
 */
check(
  "a time the clocks skip moves later, not earlier",
  expand({ recurrence: "daily", start: "2026-03-07T07:30:00.000Z" }, "2026-03-07T00:00:00Z", "2026-03-10T00:00:00Z")
    .map((o) => o.start.toLocaleTimeString("en-GB", { timeZone: NY, hour: "2-digit", minute: "2-digit" }))
    .join(","),
  "02:30,03:30,02:30",
);

if (failures.length) {
  console.error("\n" + failures.join("\n"));
  console.error(`\n  ${passed} passed, ${failures.length} FAILED\n`);
  process.exit(1);
}
console.log(`\n  ${passed} passed, 0 failed\n`);
