import type { CalendarEvent } from "@/types/calendar-event";
import { getTimeZoneParts, makeUtcDateFromParts, zonedDateTimeToUtc } from "@/lib/calendar-timezone";
import { DAY_NAMES, MONTH_NAMES, ordinal } from "@/lib/date-utils";

type RecurrenceOccurrence = { start: Date; end: Date };

const recurrenceExpansionCache = new WeakMap<CalendarEvent, Map<string, RecurrenceOccurrence[]>>();

/**
 * Given a recurring event definition, expand it into concrete {start, end}
 * occurrences that overlap the provided date range.
 */
export function expandRecurrences(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date
): RecurrenceOccurrence[] {
  if (!event.recurrence) return [];

  const cacheKey = [
    rangeStart.getTime(),
    rangeEnd.getTime(),
    event.start_time,
    event.end_time,
    event.timezone,
    event.recurrence,
    event.recurrence_until ?? "",
    (event.recurrence_exceptions ?? []).join(","),
  ].join("|");
  const eventCache = recurrenceExpansionCache.get(event);
  const cached = eventCache?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const eventStart = new Date(event.start_time);
  const eventEnd = new Date(event.end_time);
  const durationMs = eventEnd.getTime() - eventStart.getTime();
  const timeZone = event.timezone || "America/New_York";
  const recurrenceUntilMs = event.recurrence_until ? new Date(event.recurrence_until).getTime() : null;
  const exceptionStartTimes = new Set(
    (event.recurrence_exceptions ?? []).map((value) => new Date(value).getTime()),
  );

  const results: RecurrenceOccurrence[] = [];
  let iterations = 0;
  let stoppedInRange = true;
  const MAX = 1000;

  const seedParts = getTimeZoneParts(eventStart, timeZone);
  let cursor = { ...seedParts };
  const seedDayOfMonth = seedParts.day;

  function advance(days: number) {
    const utcDate = makeUtcDateFromParts(cursor);
    utcDate.setUTCDate(utcDate.getUTCDate() + days);
    cursor = getTimeZoneParts(utcDate, "UTC");
  }

  function advanceMonth(months: number) {
    const utcDate = makeUtcDateFromParts(cursor);
    utcDate.setUTCDate(1);
    utcDate.setUTCMonth(utcDate.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, 0)).getUTCDate();
    utcDate.setUTCDate(Math.min(seedDayOfMonth, lastDay));
    cursor = getTimeZoneParts(utcDate, "UTC");
  }

  /*
   * Start near the range instead of walking to it.
   *
   * The cursor seeds at the event's own start and steps one interval at a
   * time, so reaching the window costs one iteration per interval in between.
   * Against MAX that is not a truncation, it is a disappearance: a daily event
   * created more than MAX days ago spent its entire budget travelling and
   * returned nothing at all, so the event simply stopped being on the
   * calendar. Measured before this: a daily event seeded 31 Jan 2019 produced
   * zero occurrences for any window in 2026.
   *
   * Skipping whole intervals is what keeps this exact. Every step is a fixed
   * number of days (or of months, re-clamped from seedDayOfMonth every time,
   * so advanceMonth(n) lands where n separate calls would), and the arithmetic
   * happens in the same naive wall-clock space `advance` uses — so a skipped
   * occurrence is one the loop would have computed and discarded anyway.
   */
  function skipTowardRange() {
    const DAY_MS = 86_400_000;
    const stepDays =
      event.recurrence === "daily" ? 1
      // Whole weeks for weekdays, so the weekday the cursor is on is preserved.
      : event.recurrence === "weekdays" || event.recurrence === "weekly" ? 7
      : event.recurrence === "biweekly" ? 14
      : 0;

    const cursorNaiveMs = makeUtcDateFromParts(cursor).getTime();
    const rangeStartParts = getTimeZoneParts(rangeStart, timeZone);
    const rangeStartNaiveMs = makeUtcDateFromParts(rangeStartParts).getTime();

    /*
     * An occurrence that starts before the range still counts when it runs
     * into it, so never skip past `rangeStart - duration`. The extra day
     * absorbs the hour a DST change puts between wall-clock and elapsed time.
     */
    const durationDays = Math.max(0, Math.ceil(durationMs / DAY_MS));

    if (stepDays > 0) {
      const daysBehind = Math.floor((rangeStartNaiveMs - cursorNaiveMs) / DAY_MS);
      const steps = Math.floor(daysBehind / stepDays) - Math.ceil(durationDays / stepDays) - 1;
      if (steps > 0) advance(steps * stepDays);
      return;
    }

    if (event.recurrence === "monthly" || event.recurrence === "yearly") {
      const stepMonths = event.recurrence === "yearly" ? 12 : 1;
      const monthsBehind =
        (rangeStartParts.year - cursor.year) * 12 + (rangeStartParts.month - cursor.month);
      // 28 days is the shortest month, so this never under-counts the backoff.
      const steps =
        Math.floor(monthsBehind / stepMonths) - Math.ceil(durationDays / 28 / stepMonths) - 1;
      if (steps > 0) advanceMonth(steps * stepMonths);
    }
  }

  skipTowardRange();

  while (iterations < MAX) {
    iterations++;

    const dateStr = `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(cursor.day).padStart(2, "0")}`;
    const timeStr = `${String(cursor.hour).padStart(2, "0")}:${String(cursor.minute).padStart(2, "0")}`;
    const occurrenceStart = zonedDateTimeToUtc(dateStr, timeStr, timeZone, cursor.second);
    const computedEnd = new Date(occurrenceStart.getTime() + durationMs);

    if (recurrenceUntilMs !== null && occurrenceStart.getTime() >= recurrenceUntilMs) {
      stoppedInRange = false;
      break;
    }

    if (occurrenceStart > rangeEnd) {
      stoppedInRange = false;
      break;
    }

    if (
      computedEnd >= rangeStart &&
      occurrenceStart <= rangeEnd &&
      !exceptionStartTimes.has(occurrenceStart.getTime())
    ) {
      results.push({ start: occurrenceStart, end: computedEnd });
    }

    switch (event.recurrence) {
      case "daily":
        advance(1);
        break;

      case "weekdays": {
        advance(1);
        let weekday = makeUtcDateFromParts(cursor).getUTCDay();
        while (weekday === 0 || weekday === 6) {
          advance(1);
          weekday = makeUtcDateFromParts(cursor).getUTCDay();
        }
        break;
      }

      case "weekly":
        advance(7);
        break;

      case "biweekly":
        advance(14);
        break;

      case "monthly":
        advanceMonth(1);
        break;

      case "yearly":
        advanceMonth(12);
        break;

      default:
        iterations = MAX;
        stoppedInRange = false;
        break;
    }
  }

  if (stoppedInRange && iterations >= MAX) {
    console.warn(
      `expandRecurrences: hit ${MAX}-iteration cap for ${event.id ? `event ${event.id}` : "event"} ` +
        `(recurrence: ${event.recurrence}) within range ${rangeStart.toISOString()} – ${rangeEnd.toISOString()}; ` +
        "occurrences may be truncated.",
    );
  }

  const nextEventCache = eventCache ?? new Map<string, RecurrenceOccurrence[]>();
  nextEventCache.set(cacheKey, results);
  if (!eventCache) {
    recurrenceExpansionCache.set(event, nextEventCache);
  }

  return results;
}

/**
 * Return a human-readable description of a recurrence pattern.
 */
export function describeRecurrence(
  recurrence: CalendarEvent["recurrence"],
  startDate: Date
): string {
  if (!recurrence) return "";

  const dayName = DAY_NAMES[startDate.getDay()];
  const dateNum = startDate.getDate();
  const monthName = MONTH_NAMES[startDate.getMonth()];

  switch (recurrence) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday, Mon to Fri";
    case "weekly":
      return `Every week on ${dayName}`;
    case "biweekly":
      return `Every 2 weeks on ${dayName}`;
    case "monthly":
      return `Every month on the ${ordinal(dateNum)}`;
    case "yearly":
      return `Every year on ${monthName} ${dateNum}`;
    default:
      return "";
  }
}
