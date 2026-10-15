/**
 * Which calendar days an event is on, for the grids, the sidebar's counts
 * and the event's card. Pure, so it can be tested: `npm test -- event-days`.
 *
 * A timed event is on the days it runs through on this device's clock. An
 * all-day event is on its own dates wherever it is looked at from: the 5th
 * in Singapore is the 5th in New York too, not the 4th, where Singapore's
 * midnight falls. Its dates are read in its own zone, or, for one from
 * Google, which arrives with no offset (lib/google-calendar), off its times
 * as written.
 */

import type { CalendarEvent } from "@/types/calendar-event";
import { formatDateForTimeZone, hasUtcOffset } from "@/lib/calendar-timezone";
import { getAllOccurrencesInRange, type CalendarOccurrence } from "@/lib/calendar-occurrence-utils";
import { fromDateStr, monthKeyEnd, monthKeyStart, shiftDateStr, toDateStr, toMonthKey, weekdayOfDateStr } from "@/lib/date-utils";
import { DEFAULT_ZONE } from "@/lib/google-recurrence";

/** The first and last day of something, as `YYYY-MM-DD` keys. */
export type DaySpan = { first: string; last: string };

/** The days one occurrence of `event`, from `start` to `end`, is drawn on. */
export function occurrenceDays(
  event: Pick<CalendarEvent, "all_day" | "start_time" | "timezone">,
  start: Date,
  end: Date,
): DaySpan {
  // The end is where it stops, not a moment of it: an event that ends at midnight is not on the next day.
  const lastMoment = new Date(Math.max(start.getTime(), end.getTime() - 1));
  if (event.all_day && hasUtcOffset(event.start_time)) {
    const zone = event.timezone || DEFAULT_ZONE;
    return { first: formatDateForTimeZone(start, zone), last: formatDateForTimeZone(lastMoment, zone) };
  }
  return { first: toDateStr(start), last: toDateStr(lastMoment) };
}

/**
 * Every occurrence of `events` on each day from `first` to `last`. Expanded a
 * day wider on each side, since an all-day event from a zone far east or west
 * of here starts its day up to a day before or after this device's.
 */
export function occurrencesByDay(events: CalendarEvent[], first: string, last: string): Map<string, CalendarOccurrence[]> {
  const rangeStart = fromDateStr(shiftDateStr(first, -1));
  const rangeEnd = new Date(fromDateStr(shiftDateStr(last, 2)).getTime() - 1);
  const byDay = new Map<string, CalendarOccurrence[]>();
  for (const occurrence of getAllOccurrencesInRange(events, rangeStart, rangeEnd)) {
    const span = occurrenceDays(occurrence.event, occurrence.start, occurrence.end);
    const stop = span.last < last ? span.last : last;
    for (let day = span.first > first ? span.first : first; day <= stop; day = shiftDateStr(day, 1)) {
      const bucket = byDay.get(day);
      if (bucket) bucket.push(occurrence);
      else byDay.set(day, [occurrence]);
    }
  }
  return byDay;
}

/** How many occurrences of `events` are on any day from `first` to `last`. */
export function countOccurrencesOnDays(events: CalendarEvent[], first: string, last: string): number {
  const counted = new Set<CalendarOccurrence>();
  for (const day of occurrencesByDay(events, first, last).values()) {
    for (const occurrence of day) counted.add(occurrence);
  }
  return counted.size;
}

/** The days the sidebar counts: today, the week it is in (from `weekStart`), and its month. */
export function countSpans(today: string, weekStart: "sunday" | "monday"): { today: DaySpan; week: DaySpan; month: DaySpan } {
  const intoWeek = (weekdayOfDateStr(today) - (weekStart === "monday" ? 1 : 0) + 7) % 7;
  const weekFirst = shiftDateStr(today, -intoWeek);
  const month = toMonthKey(today);
  return {
    today: { first: today, last: today },
    week: { first: weekFirst, last: shiftDateStr(weekFirst, 6) },
    month: { first: monthKeyStart(month), last: monthKeyEnd(month) },
  };
}
