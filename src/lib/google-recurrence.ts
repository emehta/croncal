/**
 * Google's repeating events, read and rewritten for the event form. Pure, so
 * it can be tested: `npm test -- google-recurrence`. The calls themselves are
 * in app/api/google-calendar/events/google-edit.ts.
 *
 * A Google series is one event (the series) carrying RFC 5545 rule lines
 * (`RRULE:FREQ=WEEKLY;BYDAY=MO`, `EXDATE…`), plus one exception for each day
 * changed or deleted on its own. Measured against Google, and what
 * everything here is built around:
 *
 * - A field set on the series reaches every day, the changed days included,
 *   and overwrites that field on them. Fields not set are left alone.
 * - A new start or end on the series throws every exception away: deleted
 *   days come back, moved days snap back, renamed days lose their names.
 * - Ending a series early (an UNTIL) cancels the exceptions after the end.
 *
 * So a change to a series' times or rule, or splitting it from one day on,
 * reads the exceptions first and puts them back afterwards.
 */

import type { EventRepeat, RepeatChoice } from "@/types/calendar-event";
import {
  formatDateForTimeZone,
  formatTimeForTimeZone,
  getTimeZoneParts,
  zonedDateTimeToUtc,
} from "@/lib/calendar-timezone";
import { DAY_NAMES, DAYS_SHORT, daysBetweenDateStrs, shiftDateStr, weekdayOfDateStr } from "@/lib/date-utils";

/** A start or end as Google writes it: a day, or an instant with its zone. */
export type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleTiming = { start: GoogleTime; end: GoogleTime };

/** The parts of a Google event this file reads. */
export type GoogleEventResource = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  originalStartTime?: GoogleTime;
  recurrence?: string[];
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
};

/** Google's day codes, Sunday first, the order of `Date.getDay()`. */
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR"];

/**
 * The zone for an event that names none: UTC, never a city's. Every event
 * CronCal writes names its zone, and a Google event that names none takes
 * its calendar's (mapGoogleEvent), so this is the last resort.
 */
export const DEFAULT_ZONE = "UTC";

/* ─── times ──────────────────────────────────────────────────────────── */

/** The calendar day a time falls on, in its own zone, or `zone` if it names none. */
export function googleDate(time: GoogleTime, zone: string): string {
  if (time.date) return time.date;
  return formatDateForTimeZone(new Date(time.dateTime ?? ""), time.timeZone || zone);
}

/** The instant a time names; a day is its midnight in `zone`. */
export function googleTimeMs(time: GoogleTime, zone: string): number {
  if (time.date) return zonedDateTimeToUtc(time.date, "00:00", zone).getTime();
  return new Date(time.dateTime ?? "").getTime();
}

function wallClock(time: GoogleTime, zone: string): { time: string; second: number } {
  const instant = new Date(time.dateTime ?? "");
  const tz = time.timeZone || zone;
  return { time: formatTimeForTimeZone(instant, tz), second: getTimeZoneParts(instant, tz).second };
}

/**
 * The same wall-clock time `days` later in its own zone, so a move across a
 * daylight saving change keeps the hour it was at.
 */
export function shiftGoogleTime(time: GoogleTime, days: number, zone: string): GoogleTime {
  if (time.date) return { date: shiftDateStr(time.date, days) };
  const tz = time.timeZone || zone;
  const clock = wallClock(time, tz);
  const instant = zonedDateTimeToUtc(shiftDateStr(googleDate(time, tz), days), clock.time, tz, clock.second);
  return { dateTime: instant.toISOString(), timeZone: tz };
}

/** An instance's place in its series: a day, or the day at the series' own time. */
function slotOn(dateStr: string, seriesStart: GoogleTime, zone: string): GoogleTime {
  if (seriesStart.date) return { date: dateStr };
  const tz = seriesStart.timeZone || zone;
  const clock = wallClock(seriesStart, tz);
  return { dateTime: zonedDateTimeToUtc(dateStr, clock.time, tz, clock.second).toISOString(), timeZone: tz };
}

/** How long the series' days last: whole days for an all-day event, else milliseconds. */
function spanOf(timing: GoogleTiming, zone: string): { days: number } | { ms: number } {
  if (timing.start.date && timing.end.date) {
    return { days: daysBetweenDateStrs(timing.start.date, timing.end.date) };
  }
  return { ms: googleTimeMs(timing.end, zone) - googleTimeMs(timing.start, zone) };
}

function endAfter(start: GoogleTime, span: { days: number } | { ms: number }, zone: string): GoogleTime {
  if ("days" in span) return { date: shiftDateStr(start.date ?? googleDate(start, zone), span.days) };
  return {
    dateTime: new Date(googleTimeMs(start, zone) + span.ms).toISOString(),
    timeZone: start.timeZone || zone,
  };
}

/**
 * The series' days starting from `slot`, each as long as the series' own.
 * What a split's new series is when the times were not changed: the day it
 * starts on was perhaps moved on its own, and that move stays its own.
 */
export function timingAtSlot(slot: GoogleTime, series: GoogleTiming, zone: string): GoogleTiming {
  return { start: slot, end: endAfter(slot, spanOf(series, zone), zone) };
}

/**
 * A series' new times after one of its days was changed from `from` to `to`.
 *
 * The day moved by whole days (`dayShift`) and took a new time of day and
 * length; the series does the same from `slot`, its own first day (or the
 * first day of a split). The time of day is the one the form shows, so an
 * hour typed on a day that had been moved on its own sets the series to that
 * hour, not to the hour it is moved by.
 */
export function rebaseSeriesTiming(args: {
  slot: GoogleTime;
  from: GoogleTiming;
  to: GoogleTiming;
  zone: string;
}): { timing: GoogleTiming; dayShift: number } {
  const { slot, from, to, zone } = args;
  const toZone = to.start.timeZone || zone;
  const dayShift = daysBetweenDateStrs(googleDate(from.start, zone), googleDate(to.start, toZone));
  const firstDay = shiftDateStr(googleDate(slot, zone), dayShift);
  const start = to.start.date ? { date: firstDay } : slotOn(firstDay, to.start, toZone);
  return { timing: { start, end: endAfter(start, spanOf(to, toZone), toZone) }, dayShift };
}

/**
 * Where a day of the old series lands in the new one: `dayShift` days on, at
 * the new series' time of day. Google names an instance by this, its
 * original start, whatever it was later moved to.
 */
export function slotAfterShift(originalStart: GoogleTime, dayShift: number, seriesStart: GoogleTime, zone: string): GoogleTime {
  return slotOn(shiftDateStr(googleDate(originalStart, zone), dayShift), seriesStart, zone);
}

/** Google's id for the instance of `seriesId` at `slot`: `<id>_20261005T100000Z`, or `<id>_20261005` for a day. */
export function instanceId(seriesId: string, slot: GoogleTime): string {
  if (slot.date) return `${seriesId}_${slot.date.replaceAll("-", "")}`;
  return `${seriesId}_${basicUtc(new Date(slot.dateTime ?? ""))}`;
}

/** RFC 5545's basic UTC form: 20261005T100000Z. */
function basicUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/* ─── rule lines ─────────────────────────────────────────────────────── */

type RuleParts = Map<string, string>;

function isRuleLine(line: string): boolean {
  return /^RRULE:/i.test(line.trim());
}

function parseRule(line: string): RuleParts | null {
  const match = /^RRULE:(.*)$/i.exec(line.trim());
  if (!match) return null;
  const parts: RuleParts = new Map();
  for (const piece of match[1].split(";")) {
    const at = piece.indexOf("=");
    if (at <= 0) return null;
    parts.set(piece.slice(0, at).toUpperCase(), piece.slice(at + 1).toUpperCase());
  }
  return parts.has("FREQ") ? parts : null;
}

function formatRule(parts: RuleParts): string {
  return `RRULE:${[...parts].map(([key, value]) => `${key}=${value}`).join(";")}`;
}

/** The parts the form's six repeats can be read from. Anything else is custom. */
const PLAIN_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "UNTIL", "COUNT", "WKST"]);

function anchorOf(dateStr: string): { weekday: number; day: number; month: number } {
  return {
    weekday: weekdayOfDateStr(dateStr),
    day: Number(dateStr.slice(8, 10)),
    month: Number(dateStr.slice(5, 7)),
  };
}

/** A series' single RRULE, when it has exactly one and nothing but EXDATEs beside it. */
function soleRule(lines: readonly string[]): RuleParts | null {
  const rules = lines.filter(isRuleLine);
  if (rules.length !== 1) return null;
  if (lines.some((line) => !isRuleLine(line) && !/^EXDATE[:;]/i.test(line.trim()))) return null;
  return parseRule(rules[0]);
}

/**
 * The repeat the form shows for a series' rule, read against the day the
 * series starts on: weekly is weekly only on its own weekday.
 */
export function repeatFromRecurrence(lines: readonly string[] | null | undefined, startDate: string): RepeatChoice {
  const list = (lines ?? []).map((line) => line.trim()).filter(Boolean);
  if (!list.some(isRuleLine)) {
    return list.some((line) => /^RDATE[:;]/i.test(line)) ? "custom" : "none";
  }
  const parts = soleRule(list);
  if (!parts) return "custom";
  for (const key of parts.keys()) if (!PLAIN_PARTS.has(key)) return "custom";

  const interval = Number(parts.get("INTERVAL") ?? "1");
  const byDay = parts.get("BYDAY")?.split(",") ?? null;
  const byMonthDay = parts.get("BYMONTHDAY") ?? null;
  const byMonth = parts.get("BYMONTH") ?? null;
  const { weekday, day, month } = anchorOf(startDate);

  switch (parts.get("FREQ")) {
    case "DAILY":
      return interval === 1 && !byDay && !byMonthDay && !byMonth ? "daily" : "custom";
    case "WEEKLY": {
      if (byMonthDay || byMonth) return "custom";
      if (
        interval === 1 && byDay && byDay.length === WEEKDAY_CODES.length &&
        WEEKDAY_CODES.every((code) => byDay.includes(code))
      ) {
        return "weekdays";
      }
      const onItsDay = !byDay || (byDay.length === 1 && byDay[0] === DAY_CODES[weekday]);
      if (!onItsDay) return "custom";
      return interval === 1 ? "weekly" : interval === 2 ? "biweekly" : "custom";
    }
    case "MONTHLY":
      return interval === 1 && !byDay && !byMonth && (!byMonthDay || Number(byMonthDay) === day)
        ? "monthly"
        : "custom";
    case "YEARLY":
      return interval === 1 && !byDay &&
        (!byMonth || Number(byMonth) === month) && (!byMonthDay || Number(byMonthDay) === day)
        ? "yearly"
        : "custom";
    default:
      return "custom";
  }
}

const ORDINALS: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth", "-1": "last" };

function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * How a rule the form cannot offer reads in its list: "Every week on Mon,
 * Wed and Fri". A rule this cannot say either is named as Google's own.
 */
export function describeCustomRecurrence(lines: readonly string[] | null | undefined): string {
  const fallback = "Custom, set in Google Calendar";
  const parts = soleRule((lines ?? []).map((line) => line.trim()).filter(Boolean));
  if (!parts) return fallback;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const byDay = parts.get("BYDAY")?.split(",") ?? [];
  const otherParts = [...parts.keys()].filter((key) => !["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"].includes(key));
  if (otherParts.length > 0) return fallback;

  switch (parts.get("FREQ")) {
    case "DAILY":
      return byDay.length === 0 && interval > 1 ? `Every ${interval} days` : fallback;
    case "WEEKLY": {
      const names = byDay.map((code) => DAYS_SHORT[DAY_CODES.indexOf(code as typeof DAY_CODES[number])]);
      if (names.length === 0 || names.some((name) => !name)) return interval > 1 ? `Every ${interval} weeks` : fallback;
      return `${interval > 1 ? `Every ${interval} weeks` : "Every week"} on ${joinNames(names)}`;
    }
    case "MONTHLY": {
      const match = byDay.length === 1 ? /^(-?\d)([A-Z]{2})$/.exec(byDay[0]) : null;
      const nth = match ? ORDINALS[match[1]] : undefined;
      const dayIndex = match ? DAY_CODES.indexOf(match[2] as typeof DAY_CODES[number]) : -1;
      if (!nth || dayIndex < 0) return fallback;
      const every = interval > 1 ? `Every ${interval} months` : "Every month";
      return `${every} on the ${nth} ${DAY_NAMES[dayIndex]}`;
    }
    default:
      return fallback;
  }
}

/**
 * The rule lines for one of the form's repeats, starting on `startDate`. An
 * end the series already had (an UNTIL or a COUNT) and the days it skips
 * (EXDATE) are kept: choosing a new repeat changes how often, not until when.
 */
export function recurrenceForRepeat(repeat: EventRepeat, startDate: string, previous?: readonly string[] | null): string[] {
  const parts: RuleParts = new Map();
  const dayCode = DAY_CODES[weekdayOfDateStr(startDate)];
  switch (repeat) {
    case "daily":
      parts.set("FREQ", "DAILY");
      break;
    case "weekdays":
      parts.set("FREQ", "WEEKLY").set("BYDAY", WEEKDAY_CODES.join(","));
      break;
    case "weekly":
      parts.set("FREQ", "WEEKLY").set("BYDAY", dayCode);
      break;
    case "biweekly":
      parts.set("FREQ", "WEEKLY").set("INTERVAL", "2").set("BYDAY", dayCode);
      break;
    case "monthly":
      parts.set("FREQ", "MONTHLY");
      break;
    case "yearly":
      parts.set("FREQ", "YEARLY");
      break;
  }
  const lines = (previous ?? []).map((line) => line.trim());
  const old = lines.filter(isRuleLine).map(parseRule).find(Boolean);
  if (old?.has("UNTIL")) parts.set("UNTIL", old.get("UNTIL")!);
  else if (old?.has("COUNT")) parts.set("COUNT", old.get("COUNT")!);
  return [formatRule(parts), ...lines.filter((line) => /^EXDATE[:;]/i.test(line))];
}

/**
 * The rule after its series moved to start on another day. A rule that names
 * its day (weekly BYDAY=MO, monthly BYMONTHDAY=5) is moved with it, as Google
 * Calendar does; one that does not follows the start by itself, and a rule
 * the form cannot read is left exactly as it is.
 */
export function reanchorRecurrence(lines: readonly string[] | null | undefined, fromDate: string, toDate: string): string[] {
  const list = [...(lines ?? [])];
  if (fromDate === toDate) return list;
  const repeat = repeatFromRecurrence(list, fromDate);
  if (repeat !== "weekly" && repeat !== "biweekly" && repeat !== "monthly" && repeat !== "yearly") return list;
  const { weekday, day, month } = anchorOf(toDate);
  return list.map((line) => {
    const parts = parseRule(line);
    if (!parts) return line;
    if (parts.has("BYDAY")) parts.set("BYDAY", DAY_CODES[weekday]);
    if (parts.has("BYMONTHDAY")) parts.set("BYMONTHDAY", String(day));
    if (parts.has("BYMONTH")) parts.set("BYMONTH", String(month));
    return formatRule(parts);
  });
}

/* ─── splitting a series at a day ────────────────────────────────────── */

/**
 * The dates an EXDATE or RDATE line names, with a way to write some back.
 * `EXDATE;TZID=Asia/Singapore:20261005T180000,20261012T180000`,
 * `EXDATE;VALUE=DATE:20261005` or `EXDATE:20261005T100000Z`.
 */
function dateValues(line: string, zone: string): { values: { raw: string; ms: number }[]; write: (raw: string[]) => string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const tzid = /;TZID=([^;:]+)/i.exec(head)?.[1] ?? zone;
  const values: { raw: string; ms: number }[] = [];
  for (const raw of line.slice(colon + 1).split(",")) {
    const day = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(raw);
    if (day) {
      values.push({ raw, ms: zonedDateTimeToUtc(`${day[1]}-${day[2]}-${day[3]}`, "00:00", tzid).getTime() });
    } else if (time) {
      const [, y, mo, d, h, mi, s, z] = time;
      values.push({
        raw,
        ms: z
          ? Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
          : zonedDateTimeToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, tzid, Number(s)).getTime(),
      });
    } else {
      return null;
    }
  }
  return { values, write: (raw) => `${head}:${raw.join(",")}` };
}

/** Keep only the EXDATE and RDATE dates `keep` accepts; a line left with none goes. */
function filterDateLines(lines: readonly string[], zone: string, keep: (ms: number) => boolean, kinds: RegExp): string[] {
  return lines.flatMap((line) => {
    if (!kinds.test(line.trim())) return [line];
    const parsed = dateValues(line.trim(), zone);
    if (!parsed) return [line];
    const kept = parsed.values.filter((value) => keep(value.ms)).map((value) => value.raw);
    return kept.length > 0 ? [parsed.write(kept)] : [];
  });
}

/**
 * The series' rule, ended on the day before `pivot`: the last day it keeps
 * is the one before the first it gives up. A day pivot ends on the day
 * before; a timed one a second before its start, in UTC as RFC 5545 asks.
 */
export function endRecurrenceBefore(lines: readonly string[] | null | undefined, pivot: GoogleTime, zone: string): string[] {
  const until = pivot.date
    ? shiftDateStr(pivot.date, -1).replaceAll("-", "")
    : basicUtc(new Date(googleTimeMs(pivot, zone) - 1000));
  const pivotMs = googleTimeMs(pivot, zone);
  const trimmed = (lines ?? []).map((line) => {
    const parts = parseRule(line);
    if (!parts) return line;
    parts.delete("COUNT");
    parts.set("UNTIL", until);
    return formatRule(parts);
  });
  // An RDATE is not bound by UNTIL, so the dates past the end leave with it.
  return filterDateLines(trimmed, zone, (ms) => ms < pivotMs, /^RDATE[:;]/i);
}

/**
 * The rule for the series that carries on from `pivot`. Its end stays: an
 * UNTIL is the same date, and a COUNT loses the days the old series kept.
 * Skipped and added dates before the pivot belong to the old series.
 */
export function continueRecurrenceFrom(
  lines: readonly string[] | null | undefined,
  pivot: GoogleTime,
  zone: string,
  daysBefore: number,
): string[] {
  const pivotMs = googleTimeMs(pivot, zone);
  const carried = (lines ?? []).map((line) => {
    const parts = parseRule(line);
    if (!parts) return line;
    const count = parts.get("COUNT");
    if (count) parts.set("COUNT", String(Math.max(1, Number(count) - daysBefore)));
    return formatRule(parts);
  });
  return filterDateLines(carried, zone, (ms) => ms >= pivotMs, /^(EXDATE|RDATE)[:;]/i);
}

/** Whether a series' rule ends by counting days, which a split must count. */
export function recurrenceHasCount(lines: readonly string[] | null | undefined): boolean {
  return (lines ?? []).some((line) => parseRule(line)?.has("COUNT"));
}

export function sameLines(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

/* ─── the days changed on their own ──────────────────────────────────── */

/**
 * What a changed day had of its own, to put back once the series has
 * changed under it. Its fields are the ones that differ from the series; it
 * was moved if it starts anywhere but its slot or runs longer or shorter.
 */
export type ExceptionPlan = {
  /** Its original start, which is how Google names its place in the series. */
  slot: GoogleTime;
  cancelled: boolean;
  fields: Record<string, unknown>;
  privateFields: Record<string, string | null>;
  moved: GoogleTiming | null;
};

export function exceptionPlan(exception: GoogleEventResource, series: GoogleEventResource, zone: string): ExceptionPlan | null {
  const slot = exception.originalStartTime;
  if (!slot) return null;
  if (exception.status === "cancelled") {
    return { slot, cancelled: true, fields: {}, privateFields: {}, moved: null };
  }

  const fields: Record<string, unknown> = {};
  for (const key of ["summary", "description", "location"] as const) {
    if ((exception[key] ?? "") !== (series[key] ?? "")) fields[key] = exception[key] ?? "";
  }
  if ((exception.colorId ?? null) !== (series.colorId ?? null)) fields.colorId = exception.colorId ?? null;

  const own = exception.extendedProperties?.private ?? {};
  const inherited = series.extendedProperties?.private ?? {};
  const privateFields: Record<string, string | null> = {};
  for (const key of new Set([...Object.keys(own), ...Object.keys(inherited)])) {
    if (own[key] !== inherited[key]) privateFields[key] = own[key] ?? null;
  }

  let moved: GoogleTiming | null = null;
  if (exception.start && exception.end && series.start && series.end) {
    const ownSpan = spanOf({ start: exception.start, end: exception.end }, zone);
    const seriesSpan = spanOf({ start: series.start, end: series.end }, zone);
    const sameStart = googleTimeMs(exception.start, zone) === googleTimeMs(slot, zone) &&
      Boolean(exception.start.date) === Boolean(slot.date);
    if (!sameStart || JSON.stringify(ownSpan) !== JSON.stringify(seriesSpan)) {
      moved = { start: exception.start, end: exception.end };
    }
  }

  return { slot, cancelled: false, fields, privateFields, moved };
}

/**
 * The PATCH that puts a changed day back, without the fields this save just
 * set on every day: on the series those overwrite the day's own, and so they
 * do here. A move goes along with the series' shift in days, and is dropped
 * when the day is the one whose times were just set (the form's times are
 * its times now), or when the series changed between all-day and timed.
 */
export function restoreBody(
  plan: ExceptionPlan,
  options: { changed: ReadonlySet<string>; dayShift: number; keepMove: boolean; seriesAllDay: boolean; zone: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plan.fields)) {
    if (!options.changed.has(key)) body[key] = value;
  }
  const privateFields = Object.fromEntries(
    Object.entries(plan.privateFields).filter(([key]) => !options.changed.has(`private:${key}`)),
  );
  if (Object.keys(privateFields).length > 0) body.extendedProperties = { private: privateFields };
  const moveFits = plan.moved && Boolean(plan.moved.start.date) === options.seriesAllDay;
  if (plan.moved && options.keepMove && moveFits) {
    body.start = shiftGoogleTime(plan.moved.start, options.dayShift, options.zone);
    body.end = shiftGoogleTime(plan.moved.end, options.dayShift, options.zone);
  }
  return body;
}
