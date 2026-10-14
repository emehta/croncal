/**
 * The browser's check on what `/api/google-calendar/events` sent back.
 * Pure, so it can be tested: `npm test -- google-events-response`.
 *
 * The response used to be returned exactly as parsed. A 200 carrying
 * anything but an array (a proxy's error page turned JSON, an object from a
 * changed route, a partial deploy) reached `mergeGoogleEvents`, whose
 * `for...of` threw "googleEvents is not iterable" inside a state update, and
 * the Home dashboard was replaced by the error boundary: weather, ticker,
 * tasks and all, over one tile's worth of data. An answer that is not a list
 * of complete events is now refused here, where each caller already handles
 * a refusal: Home keeps its local events, the calendar shows its banner.
 */

import type { CalendarEvent } from "@/types/calendar-event";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * The events, or null when the body is not an array of events that can be
 * drawn: each needs an id, a title, a start and end that parse as times, an
 * end not before its start, and a boolean all_day. One bad event refuses the
 * whole answer rather than being dropped, because an event missing from the
 * calendar looks exactly like a free slot.
 */
export function parseGoogleEventsResponse(body: unknown): CalendarEvent[] | null {
  if (!Array.isArray(body)) return null;
  for (const item of body) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== "string" || item.id.length === 0) return null;
    if (typeof item.title !== "string") return null;
    if (!isInstant(item.start_time) || !isInstant(item.end_time)) return null;
    if (Date.parse(item.end_time) < Date.parse(item.start_time)) return null;
    if (typeof item.all_day !== "boolean") return null;
  }
  return body as CalendarEvent[];
}
