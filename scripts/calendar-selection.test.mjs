/**
 * What a press on a calendar event does (lib/calendar-selection). No
 * framework: `npm test -- calendar-selection`.
 *
 * What is being defended: a click that opens a card again instead of
 * selecting, a finger that can never open an event (an iPhone sends no
 * dblclick for a double tap), a double tap that opens the card twice, a
 * keyboard that cannot open one at all, and a repeating event's every day
 * lighting up together.
 */

import { doubleClickOpens, occurrenceKey, pressKind, pressOutcome } from "@/lib/calendar-selection";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (actual === expected) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Which press a click was.
check("a key's click has no detail", pressKind(0, "mouse"), "keyboard");
check("a mouse", pressKind(1, "mouse"), "mouse");
check("a second click of a mouse", pressKind(2, "mouse"), "mouse");
check("a finger", pressKind(1, "touch"), "touch");
check("a pen", pressKind(1, "pen"), "pen");
check("no pointer seen yet reads as a mouse", pressKind(1, null), "mouse");

const tuesday = occurrenceKey("standup", new Date("2026-10-13T09:00:00+08:00"));
const thursday = occurrenceKey("standup", new Date("2026-10-15T09:00:00+08:00"));
check("one occurrence is not another of the same event", tuesday === thursday, false);
check("the same occurrence is the same key", occurrenceKey("standup", new Date("2026-10-13T01:00:00Z")), tuesday);

// A mouse: a click selects, whatever is selected; only the double click opens.
check("a click selects", pressOutcome(tuesday, null, "mouse"), "select");
check("a click on the selected one still only selects", pressOutcome(tuesday, tuesday, "mouse"), "select");
check("a click moves the selection", pressOutcome(thursday, tuesday, "mouse"), "select");
check("a mouse's double click opens", doubleClickOpens("mouse"), true);

// A finger: a tap selects, a tap on the selected one opens.
check("a tap selects", pressOutcome(tuesday, null, "touch"), "select");
check("a tap on the selected one opens", pressOutcome(tuesday, tuesday, "touch"), "open");
check("a tap on another day of the series selects that day", pressOutcome(thursday, tuesday, "touch"), "select");
check("a finger's dblclick after its second tap does not open it again", doubleClickOpens("touch"), false);
check("a pen taps like a finger", pressOutcome(tuesday, tuesday, "pen"), "open");
check("a pen's dblclick does not open it twice", doubleClickOpens("pen"), false);

// A key opens at once: there is no selection to show first.
check("Enter opens", pressOutcome(tuesday, null, "keyboard"), "open");
check("Enter opens the selected one too", pressOutcome(tuesday, tuesday, "keyboard"), "open");
check("a key's double click is not a double click", doubleClickOpens("keyboard"), false);

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`calendar-selection: ${passed} passed`);
