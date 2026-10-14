import { formatDateForTimeZone } from "@/lib/calendar-timezone";
import { shiftDateStr } from "@/lib/date-utils";
import { CRONCAL_PROPERTY, googleColorId } from "@/lib/google-calendar";
import { DEFAULT_ZONE, googleDate, recurrenceForRepeat } from "@/lib/google-recurrence";
import type { CalendarEvent, EventRepeat, GoogleEventChanges, GoogleEventCreate } from "@/types/calendar-event";

export type GoogleAttendee = {
  email?: string;
  displayName?: string;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseNameEmailToken(token: string): { displayName?: string; email?: string } | null {
  const match = token.match(/^(.*?)<([^>]+)>$/);
  if (!match) return null;

  const displayName = match[1].trim().replace(/^"|"$/g, "");
  const email = match[2].trim();
  if (!isValidEmail(email)) return null;

  return {
    displayName: displayName || undefined,
    email,
  };
}

/** What Google falls back to when an event carries no time zone of its own. */
const DEFAULT_TIME_ZONE = DEFAULT_ZONE;

export type GoogleEventTime = { date: string } | { dateTime: string; timeZone: string };

/**
 * The `start` and `end` Google wants for an event, or null if the times are
 * not usable.
 *
 * An all-day event is a pair of calendar dates, end exclusive, and the dates
 * are the event's own: the form sends local midnight as a UTC instant, so in
 * Singapore the 26th arrives as 16:00 on the 25th. This used to read the date
 * off that instant in the server's zone, UTC on Vercel, so every all-day
 * event synced to Google started a day early. Reading it in the event's zone
 * gives back the day that was picked.
 */
export function googleEventTiming(fields: {
  start_time?: unknown;
  end_time?: unknown;
  all_day?: unknown;
  timezone?: unknown;
}): { start: GoogleEventTime; end: GoogleEventTime } | null {
  const { start_time, end_time, all_day, timezone } = fields;
  if (typeof start_time !== "string" || typeof end_time !== "string" || typeof all_day !== "boolean") {
    return null;
  }
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;

  const timeZone = typeof timezone === "string" && timezone ? timezone : DEFAULT_TIME_ZONE;
  if (all_day) {
    return {
      start: { date: formatDateForTimeZone(start, timeZone) },
      end: { date: shiftDateStr(formatDateForTimeZone(end, timeZone), 1) },
    };
  }
  return {
    start: { dateTime: start_time, timeZone },
    end: { dateTime: end_time, timeZone },
  };
}

export function buildGoogleCreateAttendees(participants: unknown): GoogleAttendee[] | undefined {
  if (typeof participants !== "string") return undefined;

  const attendees = participants
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => parseNameEmailToken(token) ?? (isValidEmail(token) ? { email: token } : null))
    .filter((attendee): attendee is GoogleAttendee => Boolean(attendee?.email));

  return attendees.length > 0 ? attendees : undefined;
}

export function buildGoogleUpdateAttendees(
  participants: unknown,
  existingAttendees: GoogleAttendee[],
): GoogleAttendee[] | undefined {
  if (typeof participants !== "string") {
    return participants == null ? [] : undefined;
  }

  const tokens = participants
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const attendees = tokens.flatMap((token) => {
    const parsed = parseNameEmailToken(token);
    if (parsed?.email) {
      return [{ email: parsed.email, displayName: parsed.displayName }];
    }

    const matched = existingAttendees.find(
      (attendee) =>
        attendee.email === token ||
        attendee.displayName === token ||
        (attendee.displayName && attendee.email && `${attendee.displayName} <${attendee.email}>` === token),
    );

    if (matched?.email) {
      return [{ email: matched.email, displayName: matched.displayName }];
    }

    if (isValidEmail(token)) {
      return [{ email: token }];
    }

    return [];
  });

  return attendees.length > 0 ? attendees : undefined;
}

function hasKey(changes: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

/** Whether a save moves the event: its times travel together, all four at once. */
export function changesTiming(changes: GoogleEventChanges): boolean {
  return ["start_time", "end_time", "all_day", "timezone"].some((key) => hasKey(changes, key));
}

/**
 * The fields of a Google event a save sets, other than its times and its
 * rule, as Google spells them. An emptied text field is sent as "", which
 * clears it: it used to be sent as undefined, which JSON drops, so emptying a
 * description or a location saved nothing. A colour that is not one of
 * Google's eleven is not sent, and the three things Google has no field for
 * go into the event's private properties, where null removes one.
 */
export function googleEventFields(
  changes: GoogleEventChanges,
  existingAttendees: GoogleAttendee[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (hasKey(changes, "title")) fields.summary = changes.title || "(No title)";
  if (hasKey(changes, "description")) fields.description = changes.description ?? "";
  if (hasKey(changes, "location")) fields.location = changes.location ?? "";
  if (hasKey(changes, "color")) {
    const colorId = googleColorId(changes.color);
    if (colorId) fields.colorId = colorId;
  }

  const own: Record<string, string | null> = {};
  if (hasKey(changes, "importance")) own[CRONCAL_PROPERTY.importance] = changes.importance ?? null;
  if (hasKey(changes, "event_type")) own[CRONCAL_PROPERTY.eventType] = changes.event_type ?? null;
  if (hasKey(changes, "link")) own[CRONCAL_PROPERTY.link] = changes.link ?? "";
  if (Object.keys(own).length > 0) fields.extendedProperties = { private: own };

  if (hasKey(changes, "participants")) {
    const attendees = buildGoogleUpdateAttendees(changes.participants, existingAttendees);
    if (attendees !== undefined) fields.attendees = attendees;
  }
  return fields;
}

/**
 * The Google fields a save sets, by the names `restoreBody` in
 * lib/google-recurrence knows them: set on a whole series, these overwrite a
 * day's own value, so a changed day is not given its old one back.
 */
export function changedFieldKeys(fields: Record<string, unknown>, changes: GoogleEventChanges): Set<string> {
  const keys = new Set(Object.keys(fields).filter((key) => key !== "extendedProperties"));
  const own = (fields.extendedProperties as { private?: Record<string, unknown> } | undefined)?.private ?? {};
  for (const key of Object.keys(own)) keys.add(`private:${key}`);
  if (changesTiming(changes)) keys.add("timing");
  return keys;
}

const REPEATS: readonly (EventRepeat | "none")[] = ["none", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];
const IMPORTANCES: readonly NonNullable<CalendarEvent["importance"]>[] = ["low", "medium", "high"];
const EVENT_TYPES: readonly NonNullable<CalendarEvent["event_type"]>[] = ["work", "relaxation", "admin", "free", "personal"];

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return typeof value === "string" ? value : undefined;
}

/**
 * The new event a create request describes, or what is wrong with it. The
 * body comes from the browser, so every field is checked here rather than
 * trusted: a repeat, importance or type outside the form's own is refused,
 * not passed on to Google or stored as a property nothing can read.
 */
export function readGoogleEventCreate(body: Record<string, unknown>): GoogleEventCreate | string {
  const { title, start_time, end_time, all_day, timezone, repeat, importance, event_type, color } = body;
  if (typeof title !== "string") return "The event needs a title.";
  if (typeof start_time !== "string" || typeof end_time !== "string" || typeof all_day !== "boolean") {
    return "The event needs a valid start, end and all_day.";
  }
  if (repeat !== undefined && !REPEATS.includes(repeat as EventRepeat | "none")) return "That repeat is not one the form offers.";
  if (importance != null && !IMPORTANCES.includes(importance as NonNullable<CalendarEvent["importance"]>)) return "Importance must be low, medium or high.";
  if (event_type != null && !EVENT_TYPES.includes(event_type as NonNullable<CalendarEvent["event_type"]>)) return "That type is not one the form offers.";

  return {
    title,
    start_time,
    end_time,
    all_day,
    timezone: typeof timezone === "string" && timezone ? timezone : DEFAULT_TIME_ZONE,
    description: optionalText(body.description),
    location: optionalText(body.location),
    participants: optionalText(body.participants),
    link: optionalText(body.link),
    color: typeof color === "string" ? color : undefined,
    importance: (importance ?? null) as CalendarEvent["importance"],
    event_type: (event_type ?? null) as CalendarEvent["event_type"],
    repeat: (repeat ?? "none") as EventRepeat | "none",
  };
}

/**
 * A new event as Google wants it, or null if its times are not usable.
 *
 * Everything the form holds goes with it: the title, description and
 * location; the times in the event's own zone; a repeat as Google's rule,
 * anchored on the first day; attendees; one of Google's eleven colours; and,
 * in the private properties, the importance, type and link Google has no
 * field for. It used to send the title, times, colour and attendees only, so
 * a repeating event reached Google as one day and its type, importance and
 * link were never there. An empty field is left out rather than sent empty.
 */
export function googleCreateBody(event: GoogleEventCreate): Record<string, unknown> | null {
  const timing = googleEventTiming(event);
  if (!timing) return null;

  const body: Record<string, unknown> = { summary: event.title.trim() || "(No title)", ...timing };
  const description = event.description?.trim();
  if (description) body.description = description;
  const location = event.location?.trim();
  if (location) body.location = location;
  const colorId = googleColorId(event.color);
  if (colorId) body.colorId = colorId;
  const attendees = buildGoogleCreateAttendees(event.participants);
  if (attendees) body.attendees = attendees;

  const own: Record<string, string> = {};
  if (event.importance) own[CRONCAL_PROPERTY.importance] = event.importance;
  if (event.event_type) own[CRONCAL_PROPERTY.eventType] = event.event_type;
  const link = event.link?.trim();
  if (link) own[CRONCAL_PROPERTY.link] = link;
  if (Object.keys(own).length > 0) body.extendedProperties = { private: own };

  if (event.repeat && event.repeat !== "none") {
    body.recurrence = recurrenceForRepeat(event.repeat, googleDate(timing.start, event.timezone));
  }
  return body;
}
