/**
 * `formatTime` holds its two formatters rather than building one per call,
 * and a held formatter keeps the time zone it was made in. What would go
 * wrong without a trace: after a flight, every time on the calendar still in
 * the old zone. `npm test -- time-format`.
 */

import { formatTime } from "@/lib/time-format";

const failures = [];
let passed = 0;

// Days either side of both daylight saving changes in New York and London.
const DAYS = [[2026, 2, 7], [2026, 2, 8], [2026, 2, 29], [2026, 9, 25], [2026, 10, 1]];
const ZONES = ["Asia/Singapore", "America/New_York", "Europe/London", "Asia/Kolkata", "America/Los_Angeles", "Asia/Singapore"];

for (const zone of ZONES) {
  // Changing TZ mid-run is the flight: the held formatters must follow it.
  process.env.TZ = zone;
  for (const [year, month, day] of DAYS) {
    for (let minute = 0; minute < 24 * 60; minute += 13) {
      const at = new Date(year, month, day, 0, minute);
      for (const format of ["12h", "24h"]) {
        const expected = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: format === "12h" });
        const actual = formatTime(at, format);
        if (actual === expected) passed++;
        else if (failures.length < 10) failures.push(`${zone} ${at.toString()} ${format}: ${actual}, expected ${expected}`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`time-format: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`time-format: ${passed} passed`);
