/**
 * Times typed into the time picker: `npm run test:time-input`.
 *
 * What is defended is a time that saves as something other than what was
 * typed: "9pm" stored as 09:00, a half-typed "1" becoming 01:00 on blur, or
 * 12am read as noon.
 */

import { parseTimeInput, slotIndexFor, timeSlots, timeToMinutes } from "@/lib/time-input";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const cases = [
  ["9", "09:00"], ["09", "09:00"], ["9am", "09:00"], ["9 am", "09:00"], ["9 a.m.", "09:00"],
  ["9pm", "21:00"], ["9 PM", "21:00"], ["9p", "21:00"], ["9:30", "09:30"], ["9:30pm", "21:30"],
  ["09:30", "09:30"], ["21:30", "21:30"], ["930", "09:30"], ["930p", "21:30"], ["2130", "21:30"],
  ["0000", "00:00"], ["12am", "00:00"], ["12:15am", "00:15"], ["12pm", "12:00"], ["12:45 pm", "12:45"],
  ["noon", "12:00"], ["9 : 30", "09:30"], ["Midnight", "00:00"], ["0", "00:00"], ["23:59", "23:59"], [" 7:05 ", "07:05"],
];
for (const [input, expected] of cases) check(`"${input}"`, parseTimeInput(input), expected);

const rejected = ["", "   ", "24", "24:00", "25pm", "13pm", "0am", "9:7", "9:60", "9:300", "12345", "nine", "9xm", "9:30:00", "-1"];
for (const input of rejected) check(`"${input}" is not a time`, parseTimeInput(input), null);

const slots = timeSlots(15);
check("96 quarter-hour slots", slots.length, 96);
check("first slot", slots[0], "00:00");
check("last slot", slots[95], "23:45");
check("slots are sorted and unique", slots.every((s, i) => i === 0 || s > slots[i - 1]), true);
check("30-minute slots", timeSlots(30).length, 48);
check("hourly slots", timeSlots(60).slice(0, 3), ["00:00", "01:00", "02:00"]);

check("minutes of 09:30", timeToMinutes("09:30"), 570);
check("minutes of an HH:MM:SS value", timeToMinutes("09:30:00"), 570);
check("minutes of nothing", timeToMinutes(null), null);
check("minutes of garbage", timeToMinutes("9pm"), null);

check("a value on a slot opens on it", slotIndexFor("09:30", slots), 38);
check("a value between slots opens on the one before", slotIndexFor("09:37", slots), 38);
check("midnight opens on the first", slotIndexFor("00:00", slots), 0);
check("late opens on the last", slotIndexFor("23:59", slots), 95);
check("no value opens nowhere", slotIndexFor(null, slots), -1);

// Round trip: every slot parses back to itself, 24-hour and 12-hour.
for (const slot of slots) {
  const [h, m] = slot.split(":").map(Number);
  const twelve = `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  if (parseTimeInput(slot) !== slot || parseTimeInput(twelve) !== slot) {
    check(`round trip ${slot}`, [parseTimeInput(slot), parseTimeInput(twelve)], [slot, slot]);
  }
}
check("every slot round-trips", true, true);

if (failures.length) {
  console.error(`time-input: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`time-input: all ${passed} passed`);
