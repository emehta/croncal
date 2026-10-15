/**
 * Cases for reading a wall-clock time in a zone: `npm test -- calendar-timezone`.
 *
 * What is being defended is a time typed on the day the clocks change. 02:30
 * on a spring-forward day never happens; it was read as 01:30, an hour
 * earlier than anything the owner asked for, where it should move on with
 * the clocks to 03:30. And a time that happens twice, when the clocks go
 * back, is the first of the two.
 */

import { zonedDateTimeToUtc } from "@/lib/calendar-timezone";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (actual === expected) { passed++; return; }
  failures.push(`${name}: expected ${expected}, got ${actual}`);
}

const clocks = new Map();
/** The instant as the zone's own clock reads it: "2026-03-08 03:30". */
function onClock(date, zone) {
  if (!clocks.has(zone)) {
    clocks.set(zone, new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  }
  const parts = Object.fromEntries(clocks.get(zone).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const at = (date, time, zone) => zonedDateTimeToUtc(date, time, zone).toISOString();

// An ordinary time, either side of the year.
check("New York in winter", at("2026-01-15", "09:00", "America/New_York"), "2026-01-15T14:00:00.000Z");
check("New York in summer", at("2026-07-15", "09:00", "America/New_York"), "2026-07-15T13:00:00.000Z");
check("Kolkata, half an hour off the hour", at("2026-07-15", "09:00", "Asia/Kolkata"), "2026-07-15T03:30:00.000Z");
check("UTC", at("2026-07-15", "09:00", "UTC"), "2026-07-15T09:00:00.000Z");
check("seconds are kept", zonedDateTimeToUtc("2026-07-15", "23:59", "Europe/London", 59).toISOString(), "2026-07-15T22:59:59.000Z");

// A time the clocks skip moves later by the gap.
check("02:30 on New York's spring-forward day is 03:30", onClock(zonedDateTimeToUtc("2026-03-08", "02:30", "America/New_York"), "America/New_York"), "2026-03-08 03:30");
check("01:30 on London's is 02:30", onClock(zonedDateTimeToUtc("2026-03-29", "01:30", "Europe/London"), "Europe/London"), "2026-03-29 02:30");
check("02:15 on Auckland's is 03:15", onClock(zonedDateTimeToUtc("2026-09-27", "02:15", "Pacific/Auckland"), "Pacific/Auckland"), "2026-09-27 03:15");
// Lord Howe's clocks go forward half an hour, from 02:00 to 02:30.
check("02:10 on Lord Howe's is 02:40", onClock(zonedDateTimeToUtc("2026-10-04", "02:10", "Australia/Lord_Howe"), "Australia/Lord_Howe"), "2026-10-04 02:40");
check("the hour after the gap is itself", onClock(zonedDateTimeToUtc("2026-03-08", "03:30", "America/New_York"), "America/New_York"), "2026-03-08 03:30");

// A time the clocks pass twice is the first time.
check("01:30 on New York's fall-back night is the earlier, still summer time", at("2026-11-01", "01:30", "America/New_York"), "2026-11-01T05:30:00.000Z");
check("01:30 on London's is the earlier", at("2026-10-25", "01:30", "Europe/London"), "2026-10-25T00:30:00.000Z");

// Every quarter hour of a year in each zone the tests run in reads back as itself, unless the clocks skipped it.
for (const zone of ["America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Auckland", "America/Sao_Paulo"]) {
  let wrong = 0;
  for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2027, 0, 1); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    for (let minute = 0; minute < 1440; minute += 15) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const read = onClock(zonedDateTimeToUtc(date, time, zone), zone);
      // Read back as itself, or, skipped, later on the same day by no more than an hour.
      if (read === `${date} ${time}`) continue;
      const [readDate, readTime] = read.split(" ");
      const later = readDate === date && readTime > time && (Number(readTime.slice(0, 2)) * 60 + Number(readTime.slice(3))) - minute <= 60;
      if (!later) wrong++;
    }
  }
  check(`${zone}: every time reads back as itself, or later when skipped`, wrong, 0);
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`calendar-timezone: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`calendar-timezone: ${passed} passed`);
