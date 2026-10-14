/**
 * Changing a repeating event once its form has been saved. Pure, so it can
 * be tested: `npm test -- series-edit`.
 *
 * The form opens on the day that was clicked, and only Save asks which days
 * the change is for (the owner's order, 5 Oct 2026: asking first, before
 * anything was changed, was backwards). So the save has to work out what was
 * changed on that day, which days it can go to, and, for every day of a
 * CronCal series, where the series' first day and its changed days move.
 */

import type { CalendarEvent, GoogleEventChanges, RecurrenceEditScope } from "@/types/calendar-event";
import { buildGoogleEventPatch } from "@/lib/google-event-changes";
import {
  DEFAULT_ZONE,
  type GoogleTiming,
  googleTimeMs,
  rebaseSeriesTiming,
  shiftGoogleTime,
  slotAfterShift,
} from "@/lib/google-recurrence";
import { formatDateForTimeZone, zonedDateTimeToUtc } from "@/lib/calendar-timezone";
import { shiftDateStr } from "@/lib/date-utils";

type EventFields = Partial<Omit<CalendarEvent, "id" | "created_at">>;

/**
 * What a save changed, field by field against the day as the form opened.
 * A Google event is compared as Google is sent it; a CronCal event the same
 * way, with its own rule as its repeat.
 */
export function eventChanges(current: EventFields, original: Partial<CalendarEvent>): GoogleEventChanges {
  if (original.source === "google") return buildGoogleEventPatch(current, original);
  const meta = (event: EventFields) => ({ seriesId: null, canSplit: true, repeat: event.recurrence ?? "none" as const });
  return buildGoogleEventPatch({ ...current, google: meta(current) }, { ...original, google: meta(original) });
}

/**
 * The days a change can be for. One day cannot take a repeat of its own, so
 * a new repeat is for this day onwards or for all; and only the organiser of
 * an ordinary Google event can split its series.
 */
export function scopeOptions(event: Partial<CalendarEvent>, repeatChanged: boolean): RecurrenceEditScope[] {
  return (["single", "following", "all"] as const).filter((scope) => {
    if (scope === "single") return !repeatChanged;
    if (scope === "following") return !event.google || event.google.canSplit;
    return true;
  });
}

export const SCOPE_LABELS: Record<RecurrenceEditScope, string> = {
  single: "This event",
  following: "This and following events",
  all: "All events",
};

/* ─── a CronCal series, changed for all its days ──────────────────────── */

type Timing = Pick<CalendarEvent, "start_time" | "end_time" | "all_day" | "timezone">;

/** A CronCal event's times as Google writes them: an all-day one is a pair of days, its end exclusive. */
function toGoogle(timing: Timing): GoogleTiming {
  const zone = timing.timezone;
  if (timing.all_day) {
    return {
      start: { date: formatDateForTimeZone(new Date(timing.start_time), zone) },
      end: { date: shiftDateStr(formatDateForTimeZone(new Date(timing.end_time), zone), 1) },
    };
  }
  return {
    start: { dateTime: new Date(timing.start_time).toISOString(), timeZone: zone },
    end: { dateTime: new Date(timing.end_time).toISOString(), timeZone: zone },
  };
}

/** And back: an all-day event runs from midnight to 23:59:59 on its last day, as the form saves it. */
function fromGoogle(timing: GoogleTiming, allDay: boolean, zone: string): { start_time: string; end_time: string } {
  if (allDay && timing.start.date && timing.end.date) {
    return {
      start_time: zonedDateTimeToUtc(timing.start.date, "00:00", zone).toISOString(),
      end_time: zonedDateTimeToUtc(shiftDateStr(timing.end.date, -1), "23:59", zone, 59).toISOString(),
    };
  }
  return {
    start_time: new Date(timing.start.dateTime ?? "").toISOString(),
    end_time: new Date(timing.end.dateTime ?? "").toISOString(),
  };
}

/** Whether the save moved the day: its times, all day or not, or, for a timed day, its zone. */
export function dayTimesChanged(day: { start: Date; end: Date }, series: Pick<CalendarEvent, "all_day" | "timezone">, next: Timing): boolean {
  return (
    day.start.getTime() !== new Date(next.start_time).getTime() ||
    day.end.getTime() !== new Date(next.end_time).getTime() ||
    series.all_day !== next.all_day ||
    (!next.all_day && series.timezone !== next.timezone)
  );
}

export type SeriesMovePlan = {
  start_time: string;
  end_time: string;
  /** The skipped days, on their new places. */
  recurrence_exceptions: string[];
  /** Each changed day's new place, and its times: with the series if it was at its place, else its own, shifted. */
  overrides: { id: string; original_occurrence_start: string; start_time: string; end_time: string }[];
};

/**
 * A CronCal series after one of its days moved, for all its days: the same
 * rules as a Google series (lib/google-recurrence.ts). The series takes the
 * day's new time of day and length from its own first day, shifted by as
 * many days as the day was. A skipped day stays skipped and a changed day
 * stays changed: both are named by their place in the series, so both move
 * with it, or the series would bring a skipped day back and draw a changed
 * one twice.
 */
export function planSeriesMove(
  series: CalendarEvent,
  day: { start: Date; end: Date },
  next: Timing,
  overrides: readonly CalendarEvent[],
): SeriesMovePlan {
  const zone = series.timezone || DEFAULT_ZONE;
  const newZone = next.timezone || zone;
  const from = toGoogle({ start_time: day.start.toISOString(), end_time: day.end.toISOString(), all_day: series.all_day, timezone: zone });
  const { timing, dayShift } = rebaseSeriesTiming({ slot: toGoogle({ ...series, timezone: zone }).start, from, to: toGoogle({ ...next, timezone: newZone }), zone });
  const moved = fromGoogle(timing, next.all_day, newZone);
  const length = new Date(moved.end_time).getTime() - new Date(moved.start_time).getTime();
  const oldLength = new Date(series.end_time).getTime() - new Date(series.start_time).getTime();

  const slotOf = (iso: string) => (series.all_day
    ? { date: formatDateForTimeZone(new Date(iso), zone) }
    : { dateTime: new Date(iso).toISOString(), timeZone: zone });
  const newPlace = (iso: string): string => {
    const slot = slotAfterShift(slotOf(iso), dayShift, timing.start, zone);
    return slot.date ? zonedDateTimeToUtc(slot.date, "00:00", newZone).toISOString() : new Date(slot.dateTime ?? "").toISOString();
  };

  return {
    ...moved,
    recurrence_exceptions: (series.recurrence_exceptions ?? []).map(newPlace),
    overrides: overrides
      .filter((row) => row.original_occurrence_start)
      .map((row) => {
        const place = newPlace(row.original_occurrence_start!);
        const start = new Date(row.start_time).getTime();
        const atItsPlace = start === new Date(row.original_occurrence_start!).getTime() &&
          new Date(row.end_time).getTime() - start === oldLength && row.all_day === series.all_day;
        if (atItsPlace) {
          return { id: row.id, original_occurrence_start: place, start_time: place, end_time: new Date(new Date(place).getTime() + length).toISOString() };
        }
        const rowZone = row.timezone || zone;
        const shift = (iso: string) => shiftGoogleTime({ dateTime: iso, timeZone: rowZone }, dayShift, rowZone);
        return {
          id: row.id,
          original_occurrence_start: place,
          start_time: new Date(googleTimeMs(shift(row.start_time), rowZone)).toISOString(),
          end_time: new Date(googleTimeMs(shift(row.end_time), rowZone)).toISOString(),
        };
      }),
  };
}

/** The fields a save for all days carries to the days changed on their own: as on Google, a field set on the series is set on them too. */
const CARRIED_FIELDS = ["title", "description", "location", "participants", "conferencing", "color", "importance", "event_type"] as const;

export function changedRowFields(current: EventFields, original: Partial<CalendarEvent>): Partial<CalendarEvent> {
  const changes = eventChanges(current, original);
  const fields: Record<string, unknown> = {};
  for (const key of CARRIED_FIELDS) {
    const changeKey = key === "conferencing" ? "link" : key;
    if (changeKey in changes) fields[key] = current[key] ?? null;
  }
  return fields as Partial<CalendarEvent>;
}
