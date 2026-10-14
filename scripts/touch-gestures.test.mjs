/**
 * Cases for what a touch means. No framework: `npm run test:touch`.
 *
 * What is being defended are gestures that fail silently: a vertical scroll
 * read as a swipe flips the day under the entry being read, a swipe read as
 * nothing is a card that ignores the thumb, and a tap placed in the wrong
 * slot offers an event at a time nobody chose.
 */

import { SWIPE_AXIS_RATIO, SWIPE_MIN_PX, swipeTurn, tapSelection } from "@/lib/touch-gestures";

const failures = [];
let passed = 0;

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Direction, matching the arrows: right goes back, left goes forward.
check("right swipe goes back", swipeTurn(120, 0, true), "previous");
check("left swipe goes forward", swipeTurn(-120, 0, true), "next");
check("left swipe on today does nothing", swipeTurn(-120, 0, false), null);
check("right swipe on today still goes back", swipeTurn(120, 0, false), "previous");

// A tap, or a short nudge, is not a swipe.
check("a tap is not a swipe", swipeTurn(0, 0, true), null);
check("just under the threshold", swipeTurn(SWIPE_MIN_PX - 1, 0, true), null);
check("exactly the threshold", swipeTurn(SWIPE_MIN_PX, 0, true), "previous");
check("just under the threshold, leftward", swipeTurn(-(SWIPE_MIN_PX - 1), 0, true), null);

// Scrolling the entry is mostly vertical and must never turn the day.
check("vertical scroll", swipeTurn(10, 300, true), null);
check("diagonal, more down than across", swipeTurn(80, 80, true), null);
check("at the axis ratio exactly counts", swipeTurn(90, 90 / SWIPE_AXIS_RATIO, true), "previous");
check("just steeper than the ratio", swipeTurn(90, 90 / SWIPE_AXIS_RATIO + 1, true), null);
check("upward scroll with drift", swipeTurn(-60, -200, true), null);

// Garbage in is nothing out, not a turn.
check("NaN travel", swipeTurn(Number.NaN, 0, true), null);
check("infinite travel", swipeTurn(Number.POSITIVE_INFINITY, 0, true), null);

// The calendar tap: a one-hour block from the half hour the finger landed in.
check("tap at 9:40 offers 9:30 to 10:30", tapSelection(9 * 60 + 40), { startMin: 570, endMin: 630 });
check("tap exactly on the hour", tapSelection(14 * 60), { startMin: 840, endMin: 900 });
check("tap a minute before the half hour", tapSelection(14 * 60 + 29), { startMin: 840, endMin: 900 });
check("tap at midnight", tapSelection(0), { startMin: 0, endMin: 60 });
check("tap above the grid clamps to midnight", tapSelection(-12), { startMin: 0, endMin: 60 });
check("tap at 23:40 still ends at midnight", tapSelection(23 * 60 + 40), { startMin: 1380, endMin: 1440 });
check("tap past the end of the day", tapSelection(24 * 60 + 5), { startMin: 1380, endMin: 1440 });
check("fractional minutes snap down", tapSelection(629.9), { startMin: 600, endMin: 660 });
check("NaN is no selection", tapSelection(Number.NaN), null);

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`touch gestures: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`touch gestures: ${passed} passed`);
