/**
 * What a save changes on a Google event. Pure, so it can be tested:
 * `npm test -- google-recurrence`. lib/calendar-events.ts sends it.
 */

import type { CalendarEvent, GoogleEventChanges, GoogleEventCreate } from "@/types/calendar-event";

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function sameDateTimeValue(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * What a save changes on a Google event, field by field against the event as
 * the form opened it. Only these go to Google, so a field left alone is never
 * rewritten there. Colour, importance, type and the link were not compared at
 * all, so a save that changed only those sent Google nothing, closed as if it
 * had saved, and was gone on the next load.
 */
export function buildGoogleEventPatch(
  current: Partial<Omit<CalendarEvent, "id" | "created_at">>,
  original?: Partial<CalendarEvent> | null,
): GoogleEventChanges {
  const base: Partial<CalendarEvent> = original ?? {};
  const patch: GoogleEventChanges = {};

  /*
   * Text is compared as the form leaves it, trimmed: a title Google holds
   * with a stray space would otherwise read as renamed, and on a whole series
   * that renames every day of it.
   */
  if (current.title !== undefined && !sameText(current.title, base.title)) patch.title = current.title;
  if (current.description !== undefined && !sameText(current.description, base.description)) patch.description = current.description;
  if (current.location !== undefined && !sameText(current.location, base.location)) patch.location = current.location;
  if (current.participants !== undefined && !sameText(current.participants, base.participants)) patch.participants = current.participants;
  if (current.color !== undefined && current.color.toLowerCase() !== (base.color ?? "").toLowerCase()) patch.color = current.color;
  if (current.importance !== undefined && (current.importance ?? null) !== (base.importance ?? null)) patch.importance = current.importance ?? null;
  if (current.event_type !== undefined && (current.event_type ?? null) !== (base.event_type ?? null)) patch.event_type = current.event_type ?? null;
  if (current.conferencing !== undefined && !sameText(current.conferencing, base.conferencing)) patch.link = current.conferencing ?? null;

  // "custom" is only ever the rule the series already had.
  const repeat = current.google?.repeat;
  const hadRepeat = base.google?.repeat;
  if (repeat && hadRepeat && repeat !== hadRepeat && repeat !== "custom") patch.repeat = repeat;

  /*
   * An all-day event has no zone in Google, so a zone alone is not a move:
   * the form reads one in this device's zone, which used to count as a
   * change and rewrite the dates of every all-day event saved.
   */
  const allDay = current.all_day ?? base.all_day ?? false;
  const timingChanged =
    (current.start_time !== undefined && !sameDateTimeValue(current.start_time, base.start_time)) ||
    (current.end_time !== undefined && !sameDateTimeValue(current.end_time, base.end_time)) ||
    (current.all_day !== undefined && current.all_day !== base.all_day) ||
    (!allDay && current.timezone !== undefined && current.timezone !== base.timezone);

  if (timingChanged) {
    const resolvedStart = current.start_time ?? base.start_time;
    const resolvedEnd = current.end_time ?? base.end_time;
    if (resolvedStart !== undefined) patch.start_time = resolvedStart;
    if (resolvedEnd !== undefined) patch.end_time = resolvedEnd;
    patch.all_day = allDay;
    patch.timezone = current.timezone ?? base.timezone ?? "America/New_York";
  }

  return patch;
}

/**
 * A new event, as the form saved it, in the shape Google is sent it. The
 * form's Link is `conferencing`, and its repeat is the event's own rule. The
 * meeting notes have no field in Google and no place in the form, so they
 * are not sent.
 */
export function googleCreateFields(event: Omit<CalendarEvent, "id" | "created_at">): GoogleEventCreate {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    participants: event.participants,
    start_time: event.start_time,
    end_time: event.end_time,
    all_day: event.all_day,
    timezone: event.timezone,
    color: event.color,
    importance: event.importance ?? null,
    event_type: event.event_type ?? null,
    link: event.conferencing,
    repeat: event.recurrence ?? "none",
  };
}
