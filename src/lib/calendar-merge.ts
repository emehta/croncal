import type { CalendarEvent } from "@/types/calendar-event";

/**
 * Local rows plus whatever Google has that is not already one of them.
 *
 * Google is asked with `singleEvents=true`, so a recurring series comes back
 * as one entry per instance, each with its own id. A native recurring row is a
 * single row. They can only ever be matched on an exact `google_event_id`,
 * which is why a schedule kept in both places renders twice: it lives in one
 * or the other, not both. Pure, so the reminders' server run shares it.
 */
export function mergeGoogleEvents(
  localEvents: CalendarEvent[],
  googleEvents: CalendarEvent[],
): CalendarEvent[] {
  const merged = [...localEvents];
  const localGoogleIds = new Set(
    localEvents
      .filter((event) => event.google_event_id)
      .map((event) => event.google_event_id!),
  );

  for (const googleEvent of googleEvents) {
    if (googleEvent.google_event_id && localGoogleIds.has(googleEvent.google_event_id)) {
      continue;
    }
    merged.push(googleEvent);
  }

  return merged;
}
