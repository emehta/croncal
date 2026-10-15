/**
 * Shared local-date helpers.
 *
 * Every date in the app is a *local* calendar date: something dated the 3rd
 * belongs to the 3rd in the user's timezone, not to a UTC instant. That rules
 * out `toISOString().split("T")[0]`, which silently shifts the day for anyone
 * west of UTC. `toDateStr` is the one correct way to turn a Date into the
 * `YYYY-MM-DD` key the database uses. Use these rather than a private copy.
 */

/** Sunday-first weekday names. Rotate with `orderWeekdays` from `week-start`. */
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Sunday-first three-letter weekday labels. */
export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format a Date as the `YYYY-MM-DD` key used by every dated table.
 *
 * Uses the local calendar fields on purpose: see the module comment.
 */
export function toDateStr(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Today as a `YYYY-MM-DD` key. */
export function todayStr(): string {
  return toDateStr(new Date());
}

/**
 * Parse a `YYYY-MM-DD` key back into a local midnight Date.
 *
 * `new Date("2026-03-05")` parses as UTC midnight and can render as the 4th;
 * appending a time forces local interpretation.
 */
export function fromDateStr(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

/**
 * A new Date `days` later, keeping the original time of day.
 *
 * Time is preserved because the calendar grids shift event times by whole days;
 * pair with `startOfDay` when you want a normalised boundary instead.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** A new Date `months` later, clamped to the last day of a shorter month. */
export function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/** Local midnight at the start of `date`'s day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight at the start of the *next* day: an exclusive upper bound. */
export function endOfDayExclusive(date: Date): Date {
  return addDays(startOfDay(date), 1);
}

/** Local midnight on the first of `date`'s month. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Whether two Dates fall on the same local calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Whether `date` is today in the local timezone. */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** Number of days in a given month. `month` is 0-indexed, as on Date. */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Ordinal suffix for a day number: 1 → "1st", 22 → "22nd". */
export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/* ─── Date and month keys ────────────────────────────────────────────────── */

/*
 * Arithmetic straight on the `YYYY-MM-DD` and `YYYY-MM` keys, for code that
 * reasons in calendar months rather than in instants.
 * Day counts go through Date.UTC so a daylight-saving change can never make a
 * day 23 hours long and knock a count off by one.
 */

function splitDateStr(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map(Number);
  return [y, m, d];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "2026-10" for "2026-10-12". */
export function toMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** A `YYYY-MM` key `months` later (or earlier, if negative). */
export function shiftMonthKey(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${pad2((index % 12 + 12) % 12 + 1)}`;
}

/** The first day of a month key, as a date key. */
export function monthKeyStart(monthKey: string): string {
  return `${monthKey}-01`;
}

/** The last day of a month key, as a date key. */
export function monthKeyEnd(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${pad2(getDaysInMonth(y, m - 1))}`;
}

/** A date key `days` later (or earlier, if negative). */
export function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = splitDateStr(dateStr);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetweenDateStrs(from: string, to: string): number {
  const [fy, fm, fd] = splitDateStr(from);
  const [ty, tm, td] = splitDateStr(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, for a date key. */
export function weekdayOfDateStr(dateStr: string): number {
  const [y, m, d] = splitDateStr(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The same day `months` later, clamped to the end of a shorter month: the
 * date-key twin of `addMonthsClamped`.
 */
export function shiftDateStrByMonths(dateStr: string, months: number): string {
  const [, , d] = splitDateStr(dateStr);
  const monthKey = shiftMonthKey(toMonthKey(dateStr), months);
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${pad2(Math.min(d, getDaysInMonth(y, m - 1)))}`;
}

/* ─── Display formatters ─────────────────────────────────────────────────── */

/*
 * Written from the name arrays above rather than by toLocaleDateString,
 * which builds a new Intl formatter on every call (about 20 microseconds),
 * and these run for every cell of a month grid and every row of a list. The
 * output is exactly toLocaleDateString's en-US with each one's options.
 */

/** Long date with weekday: "Monday, March 5, 2026". */
export function formatDateLongWithWeekday(date: Date): string {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
