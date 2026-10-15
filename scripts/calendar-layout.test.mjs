/**
 * Cases for where the time grid draws events. No framework: `npm test -- layout`.
 *
 * What is being defended is two meetings drawn on top of each other: it
 * throws nothing and looks, at a glance, like one event.
 */

import { enumerateDays, getClippedOccurrenceForDay, layoutEvents, minutesFromDayStart, snapToSlot } from "@/lib/calendar-layout";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const DAY = new Date(2026, 8, 25);
const at = (h, m = 0) => new Date(2026, 8, 25, h, m);
const ev = (name, sh, sm, eh, em) => ({ name, renderStart: at(sh, sm), renderEnd: at(eh, em) });

/* The horizontal span each event is drawn in, as fractions of the column. */
function spans(events) {
  const layout = layoutEvents(events);
  return events.map((e) => {
    const { col, totalCols } = layout.get(e);
    return { e, from: col / totalCols, to: (col + 1) / totalCols };
  });
}
function overlapsInTime(a, b) { return a.renderStart < b.renderEnd && b.renderStart < a.renderEnd; }
function collisions(events) {
  const s = spans(events);
  const hits = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    if (overlapsInTime(s[i].e, s[j].e) && s[i].from < s[j].to - 1e-9 && s[j].from < s[i].to - 1e-9) hits.push(`${s[i].e.name}/${s[j].e.name}`);
  }
  return hits;
}

// The case that drew two events over each other.
const X = ev("X", 9, 0, 10, 0), Y = ev("Y", 9, 30, 12, 0), V = ev("V", 10, 0, 11, 0), W = ev("W", 10, 30, 11, 0);
check("the reported case no longer collides", collisions([X, Y, V, W]), []);
check("the whole group shares one width", [...layoutEvents([X, Y, V, W]).values()].map((s) => s.totalCols), [3, 3, 3, 3]);

// Simple shapes.
check("one event is full width", [...layoutEvents([ev("A", 9, 0, 10, 0)]).values()], [{ col: 0, totalCols: 1 }]);
const A = ev("A", 9, 0, 10, 0), B = ev("B", 9, 30, 10, 30);
check("two overlapping split in half", [layoutEvents([A, B]).get(A), layoutEvents([A, B]).get(B)], [{ col: 0, totalCols: 2 }, { col: 1, totalCols: 2 }]);
const C = ev("C", 9, 0, 10, 0), D = ev("D", 10, 0, 11, 0);
check("back to back events each keep the full width", [layoutEvents([C, D]).get(C), layoutEvents([C, D]).get(D)], [{ col: 0, totalCols: 1 }, { col: 0, totalCols: 1 }]);
const E = ev("E", 9, 0, 10, 0), F = ev("F", 9, 30, 10, 30), G = ev("G", 13, 0, 14, 0);
check("a later separate event is not narrowed by an earlier group", layoutEvents([E, F, G]).get(G), { col: 0, totalCols: 1 });
const L = ev("L", 9, 0, 12, 0), S = ev("S", 9, 0, 9, 30);
check("equal starts put the longer event on the left", [layoutEvents([S, L]).get(L).col, layoutEvents([S, L]).get(S).col], [0, 1]);
check("no events", layoutEvents([]).size, 0);

// Randomised schedules: no two overlapping events ever share horizontal space.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let randomCollisions = 0;
for (let trial = 0; trial < 500; trial++) {
  const events = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, i) => {
    const start = Math.floor(rand() * 40) * 15;
    const length = 15 * (1 + Math.floor(rand() * 12));
    return { name: `r${i}`, renderStart: new Date(2026, 8, 25, 7, start), renderEnd: new Date(2026, 8, 25, 7, start + length) };
  });
  if (collisions(events).length) randomCollisions++;
}
check("500 random days, no collisions", randomCollisions, 0);

// The day helpers.
check("days of a strip", enumerateDays(new Date(2026, 8, 28, 15), new Date(2026, 9, 2, 1)).map((d) => d.getDate()), [28, 29, 30, 1, 2]);
check("an event before the day", getClippedOccurrenceForDay(at(7), at(8), new Date(2026, 8, 26)), null);
check("an overnight event is clipped to midnight",
  getClippedOccurrenceForDay(at(22), new Date(2026, 8, 26, 2), DAY).renderEnd.getTime(), new Date(2026, 8, 26).getTime());
check("minutes into the day", minutesFromDayStart(at(9, 30), DAY), 570);
check("never negative", minutesFromDayStart(new Date(2026, 8, 24, 23), DAY), 0);
check("snaps to the nearest quarter", [snapToSlot(7), snapToSlot(8), snapToSlot(52)], [0, 15, 45]);
check("the end of the day is the bottom of the grid", minutesFromDayStart(new Date(2026, 8, 26), DAY), 24 * 60);

/* Daylight saving: an event sits on its own hour line, as the clock reads,
   on the days the clock jumps. New York's, whatever this machine's zone. */
{
  const zone = process.env.TZ;
  process.env.TZ = "America/New_York";
  const spring = new Date(2026, 2, 8); // clocks go from 2:00 to 3:00
  const autumn = new Date(2026, 10, 1); // clocks go from 2:00 back to 1:00
  check("on the spring-forward day, 9:00 is on the 9:00 line", minutesFromDayStart(new Date(2026, 2, 8, 9), spring), 9 * 60);
  check("and 1:30, before the jump, on the 1:30 line", minutesFromDayStart(new Date(2026, 2, 8, 1, 30), spring), 90);
  check("on the fall-back day, 9:00 is on the 9:00 line", minutesFromDayStart(new Date(2026, 10, 1, 9), autumn), 9 * 60);
  process.env.TZ = zone;
  if (zone === undefined) delete process.env.TZ;
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`calendar layout: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`calendar layout: ${passed} passed`);
