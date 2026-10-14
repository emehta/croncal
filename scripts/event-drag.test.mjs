/**
 * Dragging an event on the time grid: `npm run test:event-drag`.
 *
 * What is defended is an event that lands somewhere other than where it was
 * dropped: hopped a day by the sideways drift of a hand moving straight
 * down, off the end of the day, or a few minutes longer or shorter than it
 * was.
 */

import { COLUMN_SWITCH_MARGIN, dragColumn, dragStartMinute, movedTimes } from "@/lib/event-drag";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const m = COLUMN_SWITCH_MARGIN;

// Wobble: anywhere in the column, or a little past either edge, stays put.
for (const x of [3, 3.01, 3.5, 3.99, 4, 4 + m - 0.01, 3 - m, 3 - m + 0.01]) {
  check(`pointer at ${x} keeps column 3`, dragColumn(3, x, 7), 3);
}
// Intent: clearly into the next column moves there.
check("a margin past the right edge moves right", dragColumn(3, 4 + m, 7), 4);
check("well into the next column moves right", dragColumn(3, 4.6, 7), 4);
check("a margin past the left edge moves left", dragColumn(3, 3 - m - 0.01, 7), 2);
check("a long pull jumps straight to the column under it", dragColumn(1, 5.5, 7), 5);
check("back again", dragColumn(5, 1.2, 7), 1);
// Once moved, the new column has its own margin: no flicking back on the line.
check("just back over the edge stays in the new column", dragColumn(4, 3.9, 7), 4);
// Ends of the strip.
check("past the last column clamps", dragColumn(5, 12, 7), 6);
check("before the first column clamps", dragColumn(1, -3, 7), 0);
check("no columns keeps the current", dragColumn(2, 4, 0), 2);
check("a non-number pointer keeps the current", dragColumn(2, NaN, 7), 2);

// A walk straight down with a 20% sideways drift never leaves the column.
{
  let col = 2;
  const cols = [];
  for (let i = 0; i < 100; i++) {
    col = dragColumn(col, 2.5 + Math.sin(i / 3) * 0.7, 7);
    cols.push(col);
  }
  check("a drifting straight-down drag never changes day", [...new Set(cols)], [2]);
}

// Vertical: follows the pointer, snapped to 15.
check("no movement stays", dragStartMinute(600, 610, 610, 60), 600);
check("down 30", dragStartMinute(600, 610, 640, 60), 630);
check("up 45", dragStartMinute(600, 610, 565, 60), 555);
check("snaps down to the nearest quarter", dragStartMinute(600, 610, 617, 60), 600);
check("snaps up past the half", dragStartMinute(600, 610, 618, 60), 615);
check("never before midnight", dragStartMinute(30, 40, -500, 60), 0);
check("never past the end of the day", dragStartMinute(1200, 1210, 5000, 90), 1350);
check("a whole-day event can only sit at 0", dragStartMinute(0, 0, 400, 1440), 0);
check("an event off the snap grid snaps when moved", dragStartMinute(607, 610, 640, 30), 630);

// Times keep the length exactly.
{
  const start = new Date(2026, 8, 29, 10, 7, 30);
  const end = new Date(2026, 8, 29, 11, 20, 0);
  const moved = movedTimes(new Date(2026, 8, 30, 15, 45), 14 * 60 + 15, start, end);
  check("new start is the day at the minute", [moved.start.getDate(), moved.start.getHours(), moved.start.getMinutes(), moved.start.getSeconds()], [30, 14, 15, 0]);
  check("length kept to the second", moved.end.getTime() - moved.start.getTime(), end.getTime() - start.getTime());
}
{
  // Across a DST change the wall clock is what is set, not a fixed offset.
  const moved = movedTimes(new Date(2026, 2, 8), 9 * 60, new Date(2026, 2, 1, 9), new Date(2026, 2, 1, 10));
  check("the start is the local wall time asked for", [moved.start.getHours(), moved.start.getMinutes()], [9, 0]);
}

if (failures.length) {
  console.error(`event-drag: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`event-drag: all ${passed} passed`);
