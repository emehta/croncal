import { endOfDayExclusive, startOfDay } from "@/lib/date-utils";

/*
 * Where the time grid draws things: the days of a strip, the part of an event
 * that falls on a given day, and side by side columns for events that overlap.
 * Pure, and tested in scripts/calendar-layout.test.mjs.
 */

/** Every day from `start` to `end`, inclusive, each at local midnight. */
export function enumerateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);

  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

/** The part of `start` to `end` that falls on `day`, or null if none of it does. */
export function getClippedOccurrenceForDay(
  start: Date,
  end: Date,
  day: Date,
): { renderStart: Date; renderEnd: Date } | null {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDayExclusive(day);

  if (end <= dayStart || start >= dayEnd) {
    return null;
  }

  return {
    renderStart: start > dayStart ? start : dayStart,
    renderEnd: end < dayEnd ? end : dayEnd,
  };
}

/**
 * Where `date` falls on `day`'s grid, in minutes from midnight: clock time,
 * as the hour lines are drawn, held to the day (0 before it, 1440 after).
 * Not the minutes elapsed since midnight, which on a daylight saving day are
 * an hour off the clock, so a 9:00 event would sit on the 8:00 line.
 */
export function minutesFromDayStart(date: Date, day: Date): number {
  if (date.getTime() <= startOfDay(day).getTime()) return 0;
  if (date.getTime() >= endOfDayExclusive(day).getTime()) return 24 * 60;
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/** `minutes` to the nearest `snap`-minute slot. */
export function snapToSlot(minutes: number, snap: number = 15): number {
  return Math.round(minutes / snap) * snap;
}

export interface ColumnSlot {
  /** Which column, from the left. */
  col: number;
  /** How many columns the width is divided into. */
  totalCols: number;
}

/**
 * Side by side columns for one day's timed events.
 *
 * Each event takes the leftmost column free at its start. Every event in a
 * connected group of overlaps then shares one column count, the group's
 * widest. Taken per event, from only the events each touched itself, two
 * overlapping events could disagree on their widths and be drawn on top of
 * each other where they meet.
 */
export function layoutEvents<T extends { renderStart: Date; renderEnd: Date }>(
  events: T[],
): Map<T, ColumnSlot> {
  const result = new Map<T, ColumnSlot>();
  if (events.length === 0) return result;

  const sorted = [...events].sort(
    (a, b) =>
      a.renderStart.getTime() - b.renderStart.getTime() ||
      b.renderEnd.getTime() - a.renderEnd.getTime(),
  );

  let group: T[] = [];
  let groupEnd = -Infinity;
  let columnEnds: number[] = [];

  const closeGroup = () => {
    const totalCols = columnEnds.length;
    for (const event of group) {
      result.set(event, { col: result.get(event)!.col, totalCols });
    }
    group = [];
    columnEnds = [];
  };

  for (const event of sorted) {
    const start = event.renderStart.getTime();
    const end = event.renderEnd.getTime();

    // Nothing in the current group is still running, so a new group starts.
    if (group.length > 0 && start >= groupEnd) closeGroup();

    let col = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[col] = end;
    }

    result.set(event, { col, totalCols: 0 });
    group.push(event);
    groupEnd = Math.max(groupEnd, end);
  }
  closeGroup();

  return result;
}
