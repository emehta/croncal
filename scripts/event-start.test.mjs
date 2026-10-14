/**
 * A new event's start, when no time was picked (src/lib/event-start.ts).
 * `npm test -- event-start`.
 */

import { nextHalfHour } from "@/lib/event-start";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (actual === expected) passed += 1;
  else failures.push(`${name}\n  expected ${expected}\n  got      ${actual}`);
}
const at = (h, m, s = 0, ms = 0) => new Date(2026, 9, 14, h, m, s, ms);
const clock = (d) => `${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${d.getSeconds()}`;

check("before the half hour, the half hour", clock(nextHalfHour(at(9, 12))), "14 09:30:0");
check("after it, the next hour", clock(nextHalfHour(at(9, 41))), "14 10:00:0");
check("exactly on the hour stays", clock(nextHalfHour(at(9, 0))), "14 09:00:0");
check("exactly on the half hour stays", clock(nextHalfHour(at(9, 30))), "14 09:30:0");
check("a second past the half hour moves on", clock(nextHalfHour(at(9, 30, 1))), "14 10:00:0");
check("late at night it rolls into tomorrow", clock(nextHalfHour(at(23, 45))), "15 00:00:0");
check("the time passed in is left alone", (() => { const d = at(9, 12); nextHalfHour(d); return clock(d); })(), "14 09:12:0");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`event-start: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`event-start: ${passed} passed`);
