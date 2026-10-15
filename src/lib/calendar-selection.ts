/**
 * Selecting an event on the calendar, and opening its card.
 *
 * A click selects (the event fills solid in its own colour) and a double
 * click opens it, so the event shows as chosen. A finger cannot double-click
 * reliably (an iPhone sends no dblclick for a double tap), so a tap selects
 * and a tap on the event already selected opens it, which is the same two
 * presses. A key (Enter or Space on the focused event) opens it at once: a
 * keyboard has no selection to show first.
 *
 * Pure, and tested: `npm test -- calendar-selection`.
 */

/** One occurrence of an event: a repeating event's Tuesday is not its Thursday. */
export function occurrenceKey(eventId: string, start: Date): string {
  return `${eventId}-${start.toISOString()}`;
}

export type PressKind = "mouse" | "touch" | "pen" | "keyboard";

/**
 * Which kind of press a click was. A click a key made has no pointer behind
 * it and a `detail` of 0; otherwise it is the pointer that went down last.
 */
export function pressKind(detail: number, pointerType: string | null): PressKind {
  if (detail === 0) return "keyboard";
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
}

/** What a single press on an event does: select it, or open its card. */
export function pressOutcome(key: string, selectedKey: string | null, press: PressKind): "select" | "open" {
  if (press === "keyboard") return "open";
  if ((press === "touch" || press === "pen") && key === selectedKey) return "open";
  return "select";
}

/**
 * Whether a double click opens the card. A mouse's does; a finger's second tap
 * has already opened it through `pressOutcome`, and some browsers send a
 * dblclick after it as well, which must not open a second time.
 */
export function doubleClickOpens(press: PressKind): boolean {
  return press === "mouse";
}
