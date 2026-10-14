import { expandRecurrences } from "@/lib/recurrence";
import type { CalendarEvent } from "@/types/calendar-event";

export interface CalendarOccurrence {
  event: CalendarEvent;
  occurrence?: { start: Date; end: Date };
  start: Date;
  end: Date;
}

export function eventsOverlapRange(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  return end >= rangeStart && start <= rangeEnd;
}

export function getOccurrencesInRange(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarOccurrence[] {
  if (event.recurrence) {
    return expandRecurrences(event, rangeStart, rangeEnd).map((occurrence) => ({
      event,
      occurrence,
      start: occurrence.start,
      end: occurrence.end,
    }));
  }

  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  if (!eventsOverlapRange(start, end, rangeStart, rangeEnd)) {
    return [];
  }

  return [{ event, start, end }];
}

export function getAllOccurrencesInRange(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarOccurrence[] {
  const results: CalendarOccurrence[] = [];

  for (const event of events) {
    results.push(...getOccurrencesInRange(event, rangeStart, rangeEnd));
  }

  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function countOccurrencesInRange(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): number {
  return getAllOccurrencesInRange(events, rangeStart, rangeEnd).length;
}
