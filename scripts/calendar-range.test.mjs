/**
 * Cases for what the calendar header says about the days on screen. No
 * framework: `npm test -- calendar-range`.
 *
 * What is being defended is a header that disagrees with the grid under it:
 * it once read "Sunday 20th to Saturday 26th" above columns running Wednesday
 * 23 to Tuesday 29. Nothing throws when that happens, and it reads as fact.
 */

import {
  centredWindowStart,
  dayWindow,
  formatWindowLabel,
  formatWindowLabelShort,
  isInWindow,
  isoWeek,
  resolveWeekWindow,
  stepDate,
  weekBadge,
  windowMonth,
} from "@/lib/calendar-range";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${name}: expected ${e}, got ${a}`);
}

const d = (y, m, day, h = 0) => new Date(y, m - 1, day, h);
const key = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

// Saturday 26 Sep 2026, centred in a week: the grid shows Wed 23 to Tue 29.
check("today centred in a week opens three days earlier", key(centredWindowStart(d(2026, 9, 26, 15), 7)), "2026-9-23");
check("a single day is its own start", key(centredWindowStart(d(2026, 9, 26, 15), 1)), "2026-9-26");
check("centring crosses a month", key(centredWindowStart(d(2026, 10, 1), 7)), "2026-9-28");
check("centring crosses a year", key(centredWindowStart(d(2026, 1, 2), 7)), "2025-12-30");

const week = dayWindow(d(2026, 9, 23), 7);
check("a week window ends six days on", key(week.end), "2026-9-29");
check("the window starts at midnight", week.start.getHours(), 0);
check("a window of one is one day", key(dayWindow(d(2026, 9, 26, 18), 1).end), "2026-9-26");

check("the label is the days on screen", formatWindowLabel(week), "Wed 23 to Tue 29 Sep");
check("a label across a month names the far month",
  formatWindowLabel(dayWindow(d(2026, 9, 28), 7)), "Mon 28 Sep to Sun 4 Oct");
check("a one-day label", formatWindowLabel(dayWindow(d(2026, 9, 26), 1)), "Sat 26 Sep");
check("the phone label", formatWindowLabelShort(week), "23 to 29 Sep");
check("the phone label across a month", formatWindowLabelShort(dayWindow(d(2026, 9, 28), 7)), "28 Sep to 4 Oct");
check("no dashes of any kind in a label",
  /[–—-]/.test(formatWindowLabel(week) + formatWindowLabelShort(dayWindow(d(2026, 9, 28), 7))), false);

// ISO weeks: 2026-09-26 (Sat) is week 39; Mon 2026-09-28 starts week 40.
check("ISO week of a Saturday", isoWeek(d(2026, 9, 26)), 39);
check("ISO week turns on Monday", isoWeek(d(2026, 9, 28)), 40);
check("1 Jan 2027 is week 53 of 2026", isoWeek(d(2027, 1, 1)), 53);
check("4 Jan 2027 is week 1", isoWeek(d(2027, 1, 4)), 1);
check("a window inside one ISO week", weekBadge(dayWindow(d(2026, 9, 21), 7)), "Week 39");
check("a window across a Monday names both weeks", weekBadge(week), "Weeks 39 to 40");
check("a window across new year", weekBadge(dayWindow(d(2026, 12, 31), 7)), "Weeks 53 to 1");
check("a single day's badge", weekBadge(dayWindow(d(2026, 9, 26), 1)), "Week 39");

check("a day inside the window", isInWindow(d(2026, 9, 29, 23), week), true);
check("the day before it", isInWindow(d(2026, 9, 22, 23), week), false);
check("the day after it", isInWindow(d(2026, 9, 30), week), false);

check("the title month is the month of most days", windowMonth(week), { month: 8, year: 2026 });
check("Sep 28 to Oct 4 is October", windowMonth(dayWindow(d(2026, 9, 28), 7)), { month: 9, year: 2026 });
check("Dec 30 to Jan 5 is January of the next year", windowMonth(dayWindow(d(2026, 12, 30), 7)), { month: 0, year: 2027 });

check("a report holding the date is used", key(resolveWeekWindow(d(2026, 9, 25), d(2026, 9, 24)).start), "2026-9-24");
check("a scroll leaves the date as the first day", key(resolveWeekWindow(d(2026, 9, 24), d(2026, 9, 24)).start), "2026-9-24");
check("a stale report after a jump is ignored", key(resolveWeekWindow(d(2026, 10, 3), d(2026, 9, 23)).start), "2026-9-30");
check("no report yet is the centred window", key(resolveWeekWindow(d(2026, 9, 26), null).start), "2026-9-23");

// Every day of two years: the centred window always holds the chosen day, spans
// seven days, and its badge names the chosen day's week.
for (let i = 0; i < 730; i++) {
  const chosen = d(2026, 1, 1 + i, 13);
  const w = dayWindow(centredWindowStart(chosen, 7), 7);
  const span = Math.round((w.end - w.start) / 86_400_000);
  const ok = isInWindow(chosen, w) && (span === 6 || span === 5 || span === 7) && weekBadge(w).includes(String(isoWeek(chosen)));
  if (!ok) failures.push(`window for ${key(chosen)}: ${key(w.start)} to ${key(w.end)}, ${weekBadge(w)}`);
  else passed++;
}

/*
 * The header's arrows. A month on from the 29th, 30th or 31st must land in
 * the next month, at its last day if it is shorter: setMonth on 31 January
 * went to 3 March, and February was never shown.
 */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
check("31 Jan, next month: 28 Feb", ymd(stepDate("month", new Date(2027, 0, 31), 1)), "2027-02-28");
check("31 Jan in a leap year: 29 Feb", ymd(stepDate("month", new Date(2028, 0, 31), 1)), "2028-02-29");
check("29 Jan, next month: still February", ymd(stepDate("month", new Date(2027, 0, 29), 1)), "2027-02-28");
check("31 Mar, back a month: 28 Feb", ymd(stepDate("month", new Date(2027, 2, 31), -1)), "2027-02-28");
check("31 Dec, next month: 31 Jan", ymd(stepDate("month", new Date(2026, 11, 31), 1)), "2027-01-31");
check("31 Oct, next month: 30 Nov", ymd(stepDate("month", new Date(2026, 9, 31), 1)), "2026-11-30");
check("next week: seven days on, across a month", ymd(stepDate("week", new Date(2026, 9, 28), 1)), "2026-11-04");
check("back a day: across a year", ymd(stepDate("day", new Date(2027, 0, 1), -1)), "2026-12-31");
// Every day of two years steps a month to the next month, never past it.
for (let d = new Date(2026, 0, 1); d < new Date(2028, 0, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
  const next = stepDate("month", d, 1);
  const months = (next.getFullYear() - d.getFullYear()) * 12 + next.getMonth() - d.getMonth();
  if (months !== 1) failures.push(`a month on from ${ymd(d)} is ${ymd(next)}`);
  else passed++;
}

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`calendar-range: ${passed} passed`);
