/**
 * Changing a repeating event once its form has been saved. Pure, so it can
 * be tested: `npm test -- series-edit`.
 *
 * The form opens on the day that was clicked, and only Save asks which days
 * the change is for, once there is a change to ask about. So the save has to
 * work out what was changed on that day, which days it can go to, and, for
 * every day of a CronCal series, where the series' first day and its changed
 * days move.
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
import { expandRecurrences } from "@/lib/recurrence";

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

/* ─── what a save writes to a CronCal series ─────────────────────────── */

/** A changed day of a series, and what a save sets on it. */
export type ChangedDayUpdate = { id: string; fields: Partial<CalendarEvent> };

export type AllDaysPlan = {
  /** Set on the series. */
  fields: Partial<CalendarEvent>;
  /** Set on its changed days. */
  days: ChangedDayUpdate[];
  /** The series no longer repeats, so its changed days go. */
  dropDays: boolean;
};

/** The form's times, all four, which travel together. */
function timingOf(updates: Timing): Timing {
  return { start_time: updates.start_time, end_time: updates.end_time, all_day: updates.all_day, timezone: updates.timezone };
}

/**
 * A change to every day of a CronCal series, from the form opened on one of
 * them. `shown` is that day as the form showed it: a day of the series, or a
 * day changed on its own, so only what the save changed against it reaches
 * the series, never the day's own differences. Moved, the series goes as far
 * as the day did (planSeriesMove), its skipped and changed days with it, and
 * the day the form was opened on, if it is a changed day, takes the form's
 * times. A field set for all days is set on the changed days too, unless
 * `carry` is off.
 */
export function planAllDaysEdit(
  series: CalendarEvent,
  shown: Pick<CalendarEvent, "id" | "start_time" | "end_time"> & EventFields,
  updates: EventFields & Timing,
  changedDays: readonly CalendarEvent[],
  carry = true,
): AllDaysPlan {
  const carried = changedRowFields(updates, shown);
  // Notes are CronCal's own, so Google's comparison above never sees them: set on the series when changed, never carried to a changed day.
  const notes = "meeting_notes" in updates && (updates.meeting_notes ?? null) !== (shown.meeting_notes ?? null)
    ? { meeting_notes: updates.meeting_notes ?? null }
    : {};
  // The series' end, only when the save set a new one: a changed day carries its own (none).
  const until = "recurrence_until" in updates && (updates.recurrence_until ?? null) !== (shown.recurrence_until ?? null)
    ? { recurrence_until: updates.recurrence_until ?? null }
    : {};
  if (!updates.recurrence) {
    // No longer repeating: one event, where the form put it.
    return {
      fields: { ...carried, ...notes, ...timingOf(updates), recurrence: null, recurrence_until: null, recurrence_exceptions: [] },
      days: [],
      dropDays: true,
    };
  }

  const fields: Partial<CalendarEvent> = { ...carried, ...notes, ...until, recurrence: updates.recurrence };
  const day = { start: new Date(shown.start_time), end: new Date(shown.end_time) };
  const toDays = (row: { id: string }, place: Partial<CalendarEvent> = {}): ChangedDayUpdate => ({
    id: row.id,
    fields: {
      ...(carry || row.id === shown.id ? carried : {}),
      ...place,
      ...(row.id === shown.id && "start_time" in place ? timingOf(updates) : {}),
    },
  });

  if (!dayTimesChanged(day, series, updates)) {
    return { fields, days: changedDays.map((row) => toDays(row)), dropDays: false };
  }
  const plan = planSeriesMove(series, day, updates, changedDays);
  return {
    fields: { ...fields, start_time: plan.start_time, end_time: plan.end_time, all_day: updates.all_day, timezone: updates.timezone, recurrence_exceptions: plan.recurrence_exceptions },
    days: plan.overrides.map(({ id, ...place }) => toDays({ id }, place)),
    dropDays: false,
  };
}

/** A series' skipped days, before `pivotIso` and from it, each in order. */
export function splitExceptionStarts(
  values: readonly string[] | null | undefined,
  pivotIso: string,
): { before: string[]; fromPivot: string[] } {
  const pivotMs = new Date(pivotIso).getTime();
  const sorted = [...new Set((values ?? []).filter(Boolean))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return {
    before: sorted.filter((value) => new Date(value).getTime() < pivotMs),
    fromPivot: sorted.filter((value) => new Date(value).getTime() >= pivotMs),
  };
}

export type FollowingPlan = {
  /** The new series, over the old one's fields. */
  next: Partial<CalendarEvent>;
  /** The changed days from the pivot on that it keeps, at their places in it; the others go. */
  days: ChangedDayUpdate[];
};

/**
 * A change to a CronCal series from one of its days on. `pivot` is the day's
 * place in the series and `shown` the day as the form showed it. The series
 * is split there, and the new series is the old one from that day, changed
 * as a change to all its days would change it (planAllDaysEdit): moved, its
 * skipped and changed days move with it, though a changed day keeps its own
 * changes. "Does not repeat" makes it one event, the form's, and the days
 * after it go; a new rule (weekly to daily) starts with no skipped or changed
 * days, since its days don't line up with the old ones.
 */
export function planFollowingEdit(
  series: CalendarEvent,
  pivot: { start: Date; end: Date },
  shown: Pick<CalendarEvent, "id" | "start_time" | "end_time"> & EventFields,
  updates: EventFields & Timing,
  changedDays: readonly CalendarEvent[],
): FollowingPlan {
  // "in", not ??: Does not repeat is a null, and must not fall back to the old rule.
  const rule = "recurrence" in updates ? updates.recurrence ?? null : series.recurrence;
  if (!rule) {
    const plan = planAllDaysEdit(series, shown, { ...updates, recurrence: null }, []);
    return { next: plan.fields, days: [] };
  }

  const pivotIso = pivot.start.toISOString();
  const { fromPivot } = splitExceptionStarts(series.recurrence_exceptions, pivotIso);
  const fromHere: CalendarEvent = { ...series, start_time: pivotIso, end_time: pivot.end.toISOString(), recurrence_exceptions: fromPivot };
  const later = changedDays.filter((row) => row.original_occurrence_start && new Date(row.original_occurrence_start).getTime() >= pivot.start.getTime());
  const plan = planAllDaysEdit(fromHere, shown, { ...updates, recurrence: rule }, later, false);
  const sameRule = rule === series.recurrence;
  return {
    next: {
      start_time: fromHere.start_time,
      end_time: fromHere.end_time,
      recurrence_until: series.recurrence_until ?? null,
      ...plan.fields,
      recurrence_exceptions: sameRule ? plan.fields.recurrence_exceptions ?? fromPivot : [],
    },
    days: sameRule ? plan.days : [],
  };
}

/**
 * The day of `series` a changed day took over: its place, at the series' own
 * times that day, which is how the series names it whatever the day was
 * changed to.
 */
export function placeOfChangedDay(
  series: CalendarEvent,
  day: Pick<CalendarEvent, "original_occurrence_start">,
): { start: Date; end: Date } | null {
  if (!day.original_occurrence_start) return null;
  const start = new Date(day.original_occurrence_start);
  if (!Number.isFinite(start.getTime())) return null;
  // The place is skipped in the series (the changed day stands in for it), so it is read with no days skipped.
  const slot = expandRecurrences({ ...series, recurrence_exceptions: [] }, start, new Date(start.getTime() + 1))
    .find((occurrence) => occurrence.start.getTime() === start.getTime());
  if (slot) return slot;
  const length = new Date(series.end_time).getTime() - new Date(series.start_time).getTime();
  return { start, end: new Date(start.getTime() + length) };
}
