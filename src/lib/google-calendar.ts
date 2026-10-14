import type { CalendarEvent } from "@/types/calendar-event";
import { toDateStr } from "@/lib/date-utils";
import { googleEndpoints } from "@/lib/google-endpoints";
import { DEFAULT_ZONE } from "@/lib/google-recurrence";

/**
 * Reading events out of Google Calendar.
 *
 * Kept out of the route handler so the paging and the mapping can be exercised
 * against a stubbed Google without standing up auth, which is how the bug
 * below was reproduced and how the fix was checked.
 */

const GOOGLE_COLOR_MAP: Record<string, string> = {
  "1": "#7986CB",  // Lavender
  "2": "#33B679",  // Sage
  "3": "#8E24AA",  // Grape
  "4": "#E67C73",  // Flamingo
  "5": "#F6BF26",  // Banana
  "6": "#F4511E",  // Tangerine
  "7": "#039BE5",  // Peacock
  "8": "#616161",  // Graphite
  "9": "#3F51B5",  // Blueberry
  "10": "#0B8043", // Basil
  "11": "#D50000", // Tomato
};
const DEFAULT_GOOGLE_COLOR = "#4285F4";

/**
 * Google's colour id for one of its eleven colours, or null for any other.
 * The event form offers only these eleven, because they are all a Google
 * event can carry; a colour picked there used to go nowhere at all.
 */
export function googleColorId(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const wanted = hex.trim().toLowerCase();
  const match = Object.entries(GOOGLE_COLOR_MAP).find(([, value]) => value.toLowerCase() === wanted);
  return match ? match[0] : null;
}

/**
 * What a Google event has no field for, kept in its private extended
 * properties: per calendar, never shown to guests, readable only by this
 * app's own Google client. A key set to null on a PATCH is removed, and a
 * PATCH merges keys rather than replacing the set (both measured), so the
 * tag another app set (`anotherAppTag` in the tests) survives every save.
 */
export const CRONCAL_PROPERTY = {
  importance: "croncalImportance",
  eventType: "croncalType",
  link: "croncalLink",
} as const;

const IMPORTANCE_VALUES = ["low", "medium", "high"] as const;
const EVENT_TYPE_VALUES = ["work", "relaxation", "admin", "free", "personal"] as const;

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return values.includes(value as T) ? (value as T) : null;
}

/**
 * events.list will not return more than 2500 on a page, and defaults to 250.
 *
 * It was left at the default with no paging, which silently truncated the
 * answer: the calendar asks for three whole months, and `orderBy=startTime`
 * means the 250 it does return are the *earliest* 250. On a schedule with a
 * dozen or more entries a day that budget is spent inside the first fortnight
 * of the window — which begins on the 1st of the previous month — so the week
 * actually on screen came back empty and the calendar looked like it had no
 * Google events at all. Nothing errored; the response was a perfectly valid
 * 200 describing the wrong fortnight.
 */
const GOOGLE_PAGE_SIZE = 2500;

/** 25,000 events. Far past any real calendar; here so a bad token loop ends. */
const MAX_PAGES = 10;

/* A page of up to 2,500 events; a request that hangs fails the read rather than holding the route. */
const GOOGLE_PAGE_TIMEOUT_MS = 20_000;

export type GoogleCalendarFailure = "scope" | "upstream";

export class GoogleCalendarError extends Error {
  kind: GoogleCalendarFailure;
  detail: string;

  constructor(kind: GoogleCalendarFailure, detail: string) {
    super(detail);
    this.name = "GoogleCalendarError";
    this.kind = kind;
    this.detail = detail;
  }
}

function isScopeError(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("access_token_scope_insufficient") ||
    normalized.includes("insufficient authentication scopes") ||
    normalized.includes("insufficientpermissions")
  );
}

type GoogleEventItem = Record<string, unknown>;

/** One Google event as the rest of the app expects to receive it. */
/** One Google event as the calendar shows it. `calendarZone` is the calendar's own, for an event that names none. */
export function mapGoogleEvent(item: GoogleEventItem, calendarZone?: string): CalendarEvent {
  const startObj = (item.start ?? {}) as Record<string, string>;
  const endObj = (item.end ?? {}) as Record<string, string>;
  const isAllDay = Boolean(startObj.date);

  let startTime: string;
  let endTime: string;

  if (isAllDay) {
    /*
     * Google gives all-day events an exclusive end date. Both ends are
     * written back without an offset on purpose: an all-day event belongs to
     * the calendar day it is on, whatever zone the reader is in, and a
     * zoneless timestamp is parsed as local time by the browser.
     */
    const startDate = new Date(`${startObj.date}T00:00:00`);
    const exclusiveEnd = new Date(`${endObj.date}T00:00:00`);
    const inclusiveEnd = new Date(exclusiveEnd.getTime() - 1000);
    startTime = `${toDateStr(startDate)}T00:00:00`;
    endTime = `${toDateStr(inclusiveEnd)}T23:59:59`;
  } else {
    startTime = startObj.dateTime;
    endTime = endObj.dateTime;
  }

  const attendees = item.attendees as Array<{ email?: string; displayName?: string; self?: boolean; responseStatus?: string }> | undefined;
  const participants = attendees
    ? attendees.map((a) => a.displayName || a.email || "").filter(Boolean).join(", ")
    : null;

  const extended = item.extendedProperties as { private?: Record<string, string> } | undefined;
  const own = extended?.private ?? {};

  /*
   * A link typed in CronCal wins over the meeting's own, and once typed it is
   * what shows, even emptied: clearing the field must not bring the Meet link
   * back as if the save had not happened.
   */
  const conferenceData = item.conferenceData as Record<string, unknown> | undefined;
  const entryPoints = conferenceData?.entryPoints as Array<{ uri?: string }> | undefined;
  const conferencing = own[CRONCAL_PROPERTY.link] !== undefined
    ? own[CRONCAL_PROPERTY.link] || null
    : (item.hangoutLink as string) || entryPoints?.[0]?.uri || null;

  const colorId = item.colorId as string | undefined;
  const seriesId = (item.recurringEventId as string | undefined) ?? null;
  const organizer = item.organizer as { self?: boolean } | undefined;
  const eventType = (item.eventType as string | undefined) ?? "default";

  return {
    id: `google_${item.id as string}`,
    title: (item.summary as string) || "(No title)",
    description: (item.description as string) || null,
    start_time: startTime,
    end_time: endTime,
    all_day: isAllDay,
    timezone: startObj.timeZone || calendarZone || DEFAULT_ZONE,
    recurrence: null,
    participants,
    conferencing,
    meeting_notes: null,
    location: (item.location as string) || null,
    color: colorId ? (GOOGLE_COLOR_MAP[colorId] ?? DEFAULT_GOOGLE_COLOR) : DEFAULT_GOOGLE_COLOR,
    importance: oneOf(IMPORTANCE_VALUES, own[CRONCAL_PROPERTY.importance]),
    event_type: oneOf(EVENT_TYPE_VALUES, own[CRONCAL_PROPERTY.eventType]),
    source: "google",
    google_event_id: item.id as string,
    google: {
      seriesId,
      /* Only on an invitation the owner declined, so every other event keeps its shape. */
      ...(attendees?.some((attendee) => attendee.self === true && attendee.responseStatus === "declined") ? { declined: true } : {}),
      canSplit: organizer?.self === true && eventType === "default",
      repeat: seriesId ? undefined : "none",
    },
    created_at: (item.created as string) || new Date().toISOString(),
  };
}

export type FetchGoogleEventsOptions = {
  accessToken: string;
  timeMin: string;
  timeMax: string;
  /** Injected by the verification script; the real caller uses global fetch. */
  fetchImpl?: typeof fetch;
};

/** Every event in the window, following Google's paging to the end of it. */
export async function fetchGoogleCalendarEvents(
  options: FetchGoogleEventsOptions,
): Promise<CalendarEvent[]> {
  const { accessToken, timeMin, timeMax } = options;
  const doFetch = options.fetchImpl ?? fetch;

  const items: GoogleEventItem[] = [];
  let calendarZone: string | undefined;
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(GOOGLE_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await doFetch(
      `${googleEndpoints().events}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(GOOGLE_PAGE_TIMEOUT_MS) },
    );

    if (!response.ok) {
      const errorText = await response.text();
      /*
       * A 401 is a token Google no longer accepts, revoked or invalid, which
       * like a missing scope only a reconnect fixes. The events route used to
       * learn that from a tokeninfo call before every fetch.
       */
      const reconnect = response.status === 401 || isScopeError(errorText);
      throw new GoogleCalendarError(reconnect ? "scope" : "upstream", errorText);
    }

    const page = await response.json() as { items?: GoogleEventItem[]; nextPageToken?: string; timeZone?: string };
    if (page.items) items.push(...page.items);
    if (page.timeZone) calendarZone = page.timeZone;
    pageToken = page.nextPageToken;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  if (pageToken) {
    console.warn(
      `Google Calendar returned more than ${MAX_PAGES * GOOGLE_PAGE_SIZE} events for ${timeMin}..${timeMax}; the rest were not read.`,
    );
  }

  return items.map((item) => mapGoogleEvent(item, calendarZone));
}
