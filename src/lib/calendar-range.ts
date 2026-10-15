/**
 * Which days the calendar's time grid is showing, and how the header names
 * them. Pure, so it can be tested: `npm test -- calendar-range`.
 *
 * The week view is a continuous strip, not a paged calendar week. A jump to a
 * date (Today, the arrows, the mini calendar) centres that day so it has its
 * neighbours on both sides, and a scroll can stop on any day. So the seven
 * columns on screen are usually not the calendar week the chosen date sits
 * in, and everything the header and the mini calendar say about the week
 * comes from the window on screen.
 */

import { DAYS_SHORT, MONTHS_SHORT } from "@/lib/date-utils";

export interface DayWindow {
  /** Local midnight of the first visible day. */
  start: Date;
  /** Local midnight of the last visible day. */
  end: Date;
}

function midnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The first column when `date` is centred in a window `count` days wide: the
 * rule the grid itself follows for a jump, so the header's first frame agrees
 * with the grid before the grid has reported anything.
 */
export function centredWindowStart(date: Date, count: number): Date {
  return plusDays(midnight(date), -Math.floor((count - 1) / 2));
}

/** `count` days from `start`, inclusive of both ends. */
export function dayWindow(start: Date, count: number): DayWindow {
  const first = midnight(start);
  return { start: first, end: plusDays(first, Math.max(1, count) - 1) };
}

/** ISO 8601 week number: weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * "Week 39", or "Weeks 39 to 40" for a window that crosses a Monday. Every
 * week the window touches is named, so the badge never claims a week the
 * grid has left.
 */
export function weekBadge({ start, end }: DayWindow): string {
  const first = isoWeek(start);
  const last = isoWeek(end);
  return first === last ? `Week ${first}` : `Weeks ${first} to ${last}`;
}

/** "Thu 16 Oct", the way every date in CronCal is written. */
function dayLabel(date: Date): string {
  return `${DAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/**
 * The desktop range: "Wed 23 to Tue 29 Sep", or "Mon 28 Sep to Sun 4 Oct"
 * across a month. A one-day window is the day alone.
 */
export function formatWindowLabel({ start, end }: DayWindow): string {
  if (start.getTime() === end.getTime()) return dayLabel(start);
  const first = start.getMonth() === end.getMonth() ? `${DAYS_SHORT[start.getDay()]} ${start.getDate()}` : dayLabel(start);
  return `${first} to ${dayLabel(end)}`;
}

/** The phone range: "23 to 29 Sep", or "28 Sep to 4 Oct" across a month. */
export function formatWindowLabelShort({ start, end }: DayWindow): string {
  if (start.getTime() === end.getTime()) return dayLabel(start);
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()} to ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`
    : `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]} to ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`;
}

/** Whether `date` is one of the window's days. */
export function isInWindow(date: Date, { start, end }: DayWindow): boolean {
  const day = midnight(date).getTime();
  return day >= start.getTime() && day <= end.getTime();
}

/**
 * The month and year the title names: the month most of the window's days
 * fall in, ties to the later month. A window of Sep 28 to Oct 4 is October,
 * which is where four of its seven days are.
 */
export function windowMonth({ start, end }: DayWindow): { month: number; year: number } {
  const counts = new Map<string, number>();
  for (let d = start; d.getTime() <= end.getTime(); d = plusDays(d, 1)) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count >= bestCount) {
      best = key;
      bestCount = count;
    }
  }
  const [year, month] = best.split("-").map(Number);
  return { month, year };
}

/**
 * The week window the header should describe. The grid's last report wins
 * while it still holds the chosen date, which is true after any scroll (the
 * chosen date *is* its first day then) and after a jump once the grid has
 * landed. In the frame between a jump and the grid reporting, the report is
 * stale and does not hold the new date, so the centred window the grid is
 * about to show is used instead.
 */
export function resolveWeekWindow(currentDate: Date, reportedStart: Date | null, count = 7): DayWindow {
  if (reportedStart) {
    const reported = dayWindow(reportedStart, count);
    if (isInWindow(currentDate, reported)) return reported;
  }
  return dayWindow(centredWindowStart(currentDate, count), count);
}
