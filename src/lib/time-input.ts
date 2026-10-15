/**
 * Times as a person types them, and the slots the time picker lists. Pure, so
 * it can be tested: `npm test -- time-input`.
 *
 * TimeField stands in for the browser's own `<input type="time">`, which
 * draws the operating system's picker: a spinner on one machine, a clock face
 * on another, and on a phone a wheel that ignores the theme entirely. It
 * lists the day in steps and takes whatever is typed, so this is what
 * "whatever is typed" means.
 */

/** "HH:MM", 24-hour, the form every time is stored and compared in. */
export type TimeValue = string;

const MERIDIEM = /^(a|am|p|pm)$/;

/**
 * Reads "9", "9am", "9:30 pm", "09:30", "21:30", "930p", "2130", "12a" and
 * "noon" / "midnight". Returns null for anything that is not a time, so a
 * half-typed value never becomes 00:00 by accident.
 */
export function parseTimeInput(raw: string): TimeValue | null {
  const text = raw.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (!text) return null;
  if (text === "noon") return "12:00";
  if (text === "midnight") return "00:00";

  const match = /^(\d{1,4})(?::(\d{1,2}))?([a-z]*)$/.exec(text);
  if (!match) return null;
  const [, digits, minutePart, suffix] = match;
  if (suffix && !MERIDIEM.test(suffix)) return null;

  let hour: number;
  let minute: number;
  if (minutePart !== undefined) {
    if (digits.length > 2 || minutePart.length !== 2) return null;
    hour = Number(digits);
    minute = Number(minutePart);
  } else if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else {
    // "930" is 9:30 and "2130" is 21:30: the last two digits are minutes.
    hour = Number(digits.slice(0, -2));
    minute = Number(digits.slice(-2));
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    const pm = suffix.startsWith("p");
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Every time of day in steps of `stepMinutes`, from 00:00. */
export function timeSlots(stepMinutes = 15): TimeValue[] {
  const step = Math.max(1, Math.min(60, Math.floor(stepMinutes)));
  const slots: TimeValue[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return slots;
}

/** Minutes after midnight, or null for a value that is not "HH:MM". */
export function timeToMinutes(value: string | null | undefined): number | null {
  const match = value ? /^(\d{2}):(\d{2})/.exec(value) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

/**
 * The slot the list should open on: the value's own slot, or the last one
 * before it when the value falls between steps (09:37 opens on 09:30).
 */
export function slotIndexFor(value: string | null | undefined, slots: readonly TimeValue[]): number {
  const minutes = timeToMinutes(value);
  if (minutes === null || slots.length === 0) return -1;
  let index = 0;
  for (let i = 0; i < slots.length; i++) {
    const slotMinutes = timeToMinutes(slots[i]);
    if (slotMinutes !== null && slotMinutes <= minutes) index = i;
  }
  return index;
}
