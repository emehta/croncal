export interface TimeZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * One formatter per zone, kept.
 *
 * Constructing an Intl.DateTimeFormat is among the more expensive calls in the
 * language. Resolving one wall-clock time to an instant calls getTimeZoneParts
 * up to four times, and expanding a recurrence does that once per occurrence,
 * so a fresh formatter per read would mean thousands to draw a month of a
 * daily event, all asking the same question about the same zone.
 *
 * A formatter is immutable and stateless once built, so reusing one is safe.
 * The app deals in a handful of zones, so the map cannot grow unbounded in any
 * realistic use.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** A timestamp that names its own offset ("Z", "+08:00", "-0500"). */
export function hasUtcOffset(timestamp: string): boolean {
  return /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp.trim());
}

/**
 * The zone the event form reads an event's times in.
 *
 * A Google all-day event arrives with no offset on its times
 * (lib/google-calendar.ts): it is a pair of calendar days, and a zoneless
 * timestamp is this device's wall clock. Read in the zone Google names
 * instead, or New York when it names none, those midnights would fall on the
 * day before anywhere east of it, so in Singapore the form would show the 2nd
 * for an event on the 3rd, and saving it, even with only a new title, would
 * move the event in Google.
 */
export function eventFormTimeZone(
  event: { all_day?: boolean | null; start_time?: string | null; timezone?: string | null } | null | undefined,
): string {
  if (event?.all_day && event.start_time && !hasUtcOffset(event.start_time)) return getBrowserTimeZone();
  return event?.timezone ?? getBrowserTimeZone();
}

export function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    return value ? Number(value) : 0;
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function formatDateForTimeZone(date: Date, timeZone: string): string {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatTimeForTimeZone(date: Date, timeZone: string): string {
  const parts = getTimeZoneParts(date, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function partsToNaiveUtcMs(parts: TimeZoneParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  return partsToNaiveUtcMs(parts) - date.getTime();
}

const DAY_MS = 86_400_000;

/**
 * The instant a wall-clock time names in `timeZone`.
 *
 * Read with the zone's offset a day either side, so a change of the clocks
 * in between is seen. Where the clocks go back, the time comes twice and the
 * first is meant. Where they go forward, the time never comes: 02:30 on a
 * spring-forward day is read with the offset from before the change, which
 * lands it as late as the gap is long (03:30), never earlier, so a time
 * typed there moves forward the way the clocks did.
 */
export function zonedDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
  second = 0,
): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const naiveUtcMs = partsToNaiveUtcMs({ year, month, day, hour, minute, second });

  const before = getTimeZoneOffsetMs(new Date(naiveUtcMs - DAY_MS), timeZone);
  const after = getTimeZoneOffsetMs(new Date(naiveUtcMs + DAY_MS), timeZone);
  if (before === after) return new Date(naiveUtcMs - before);

  const exact = [naiveUtcMs - before, naiveUtcMs - after]
    .filter((candidate) => partsToNaiveUtcMs(getTimeZoneParts(new Date(candidate), timeZone)) === naiveUtcMs);
  return new Date(exact.length > 0 ? Math.min(...exact) : naiveUtcMs - before);
}

export function shiftInstantToTimeZoneFields(
  start: Date,
  end: Date,
  timeZone: string,
): {
  startDateStr: string;
  startTimeStr: string;
  endDateStr: string;
  endTimeStr: string;
} {
  return {
    startDateStr: formatDateForTimeZone(start, timeZone),
    startTimeStr: formatTimeForTimeZone(start, timeZone),
    endDateStr: formatDateForTimeZone(end, timeZone),
    endTimeStr: formatTimeForTimeZone(end, timeZone),
  };
}

export function makeUtcDateFromParts(parts: TimeZoneParts): Date {
  return new Date(partsToNaiveUtcMs(parts));
}

/** "GMT+8": the zone's offset at a moment, now unless given one. */
export function zoneOffset(timeZone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((entry) => entry.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

/** "America/New_York" as "New York". */
export function zoneLabel(timeZone: string): string {
  if (timeZone === "UTC") return "UTC";
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}
