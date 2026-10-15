import { formatDateForTimeZone } from "@/lib/calendar-timezone";
import { shiftDateStr } from "@/lib/date-utils";
import { CRONCAL_PROPERTY, googleColorId } from "@/lib/google-calendar";
import { DEFAULT_ZONE, googleDate, recurrenceForRepeat } from "@/lib/google-recurrence";
import type { CalendarEvent, EventRepeat, GoogleEventChanges, GoogleEventCreate } from "@/types/calendar-event";

/**
 * A guest as Google holds one. Google's own fields beside the name and
 * address (optional, responseStatus, comment, organizer) ride along untouched,
 * so a save that changes the guest list keeps each guest's answer.
 */
export type GoogleAttendee = {
  email?: string;
  displayName?: string;
  [field: string]: unknown;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Text that runs to the next comma or the end of the line. */
const ENDS_HERE = /^\s*(,|$)/;

/**
 * The guests a participants line names, in order and each once, onto the
 * guests the event already has, matched by address. The line is the form's:
 * names and addresses separated by commas, as mapGoogleEvent writes it
 * ("Lee, Ann, bob@y.com") or as typed ("Ann <ann@x.com>"). A name can hold a
 * comma, so the line is never cut at every comma: a guest already on the
 * event is read by its whole name first, then a bare address, then a name
 * (commas and all) with an address after it. Anything else, up to the next
 * comma, names nobody and is dropped.
 */
export function readGuestList(line: string, existing: readonly GoogleAttendee[] = []): GoogleAttendee[] {
  const known = existing
    .filter((guest) => typeof guest.email === "string" && guest.email)
    .flatMap((guest) => [guest.email, guest.displayName, guest.displayName ? `${guest.displayName} <${guest.email}>` : null]
      .filter((label): label is string => typeof label === "string" && label.trim() !== "")
      .map((label) => ({ label: label.trim(), guest })))
    .sort((a, b) => b.label.length - a.label.length);
  const byEmail = new Map(existing.filter((guest) => guest.email).map((guest) => [String(guest.email).toLowerCase(), guest]));

  const guests: GoogleAttendee[] = [];
  const seen = new Set<string>();
  const add = (email: string, displayName?: string) => {
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const current = byEmail.get(key);
    guests.push(current ? { ...current, ...(displayName ? { displayName } : {}) } : { email, ...(displayName ? { displayName } : {}) });
  };

  let rest = line;
  for (;;) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) break;
    const match = known.find(({ label }) => rest.startsWith(label) && ENDS_HERE.test(rest.slice(label.length)));
    if (match) {
      add(String(match.guest.email));
      rest = rest.slice(match.label.length);
      continue;
    }
    const address = /^([^\s,<>"]+@[^\s,<>"]+)(?=\s*(,|$))/.exec(rest);
    if (address && isValidEmail(address[1])) {
      add(address[1]);
      rest = rest.slice(address[0].length);
      continue;
    }
    const named = /^(?:"([^"]*)"|([^<>"@]*?))\s*<([^<>\s]+)>(?=\s*(,|$))/.exec(rest);
    if (named && isValidEmail(named[3])) {
      add(named[3], (named[1] ?? named[2]).trim() || undefined);
      rest = rest.slice(named[0].length);
      continue;
    }
    const comma = rest.indexOf(",");
    rest = comma < 0 ? "" : rest.slice(comma + 1);
  }
  return guests;
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
 * Singapore the 26th arrives as 16:00 on the 25th. Read in the server's
 * zone, that instant would start the event a day early; read in the event's
 * zone, it gives back the day that was picked.
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
  const attendees = readGuestList(participants);
  return attendees.length > 0 ? attendees : undefined;
}

/**
 * The guest list a save sends: emptied, the guests go; a line that names
 * nobody leaves them as they are rather than dropping everyone.
 */
export function buildGoogleUpdateAttendees(
  participants: unknown,
  existingAttendees: readonly GoogleAttendee[],
): GoogleAttendee[] | undefined {
  if (typeof participants !== "string") {
    return participants == null ? [] : undefined;
  }
  if (!participants.trim()) return [];
  const attendees = readGuestList(participants, existingAttendees);
  return attendees.length > 0 ? attendees : undefined;
}

function hasKey(changes: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

/** Whether a save moves the event: its times travel together, all four at once. */
export function changesTiming(changes: object): boolean {
  return ["start_time", "end_time", "all_day", "timezone"].some((key) => hasKey(changes, key));
}

/**
 * The fields of a Google event a save sets, other than its times and its
 * rule, as Google spells them. An emptied text field is sent as "", which
 * clears it, not as undefined, which JSON drops. A colour that is not one of
 * Google's eleven is not sent, and the three things Google has no field for
 * go into the event's private properties, where null removes one.
 */
export function googleEventFields(
  changes: GoogleEventChanges,
  existingAttendees: readonly GoogleAttendee[],
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

/** What is wrong with a repeat, priority, type or colour from the browser, or null. */
function choiceProblem(body: Record<string, unknown>): string | null {
  const { repeat, importance, event_type, color } = body;
  if (repeat !== undefined && !REPEATS.includes(repeat as EventRepeat | "none")) return "That repeat is not one the form offers.";
  if (importance != null && !IMPORTANCES.includes(importance as NonNullable<CalendarEvent["importance"]>)) return "Priority must be low, medium or high.";
  if (event_type != null && !EVENT_TYPES.includes(event_type as NonNullable<CalendarEvent["event_type"]>)) return "That type is not one the form offers.";
  if (color !== undefined && typeof color !== "string") return "That colour is not one the form offers.";
  return null;
}

/**
 * The new event a create request describes, or what is wrong with it. The
 * body comes from the browser, so every field is checked here rather than
 * trusted: a repeat, priority or type outside the form's own is refused,
 * not passed on to Google or stored as a property nothing can read.
 */
export function readGoogleEventCreate(body: Record<string, unknown>): GoogleEventCreate | string {
  const { title, start_time, end_time, all_day, timezone, repeat, importance, event_type, color } = body;
  if (typeof title !== "string") return "The event needs a title.";
  if (typeof start_time !== "string" || typeof end_time !== "string" || typeof all_day !== "boolean") {
    return "The event needs a valid start and end.";
  }
  const problem = choiceProblem(body);
  if (problem) return problem;

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
 * A change request, checked as a create request is: only the keys the form
 * sends are read, each must be of its own kind, and the times travel
 * together, all four valid, or the change is refused.
 */
export function readGoogleEventChanges(body: Record<string, unknown>): GoogleEventChanges | string {
  const changes: GoogleEventChanges = {};
  if (hasKey(body, "title")) {
    if (typeof body.title !== "string") return "The title must be text.";
    changes.title = body.title;
  }
  for (const key of ["description", "location", "participants", "link"] as const) {
    if (!hasKey(body, key)) continue;
    const value = optionalText(body[key]);
    if (value === undefined) return `The ${key} must be text.`;
    changes[key] = value;
  }
  const problem = choiceProblem(body);
  if (problem) return problem;
  if (hasKey(body, "color")) changes.color = body.color as string;
  if (hasKey(body, "importance")) changes.importance = (body.importance ?? null) as CalendarEvent["importance"];
  if (hasKey(body, "event_type")) changes.event_type = (body.event_type ?? null) as CalendarEvent["event_type"];
  if (hasKey(body, "repeat")) changes.repeat = body.repeat as EventRepeat | "none";

  if (changesTiming(body)) {
    const { start_time, end_time, all_day, timezone } = body;
    if (!googleEventTiming(body) || typeof timezone !== "string" || !timezone) {
      return "The event needs a valid start and end.";
    }
    Object.assign(changes, { start_time, end_time, all_day, timezone });
  }
  return changes;
}

/**
 * A new event as Google wants it, or null if its times are not usable.
 *
 * Everything the form holds goes with it: the title, description and
 * location; the times in the event's own zone; a repeat as Google's rule,
 * anchored on the first day; attendees; one of Google's eleven colours; and,
 * in the private properties, the importance, type and link Google has no
 * field for. An empty field is left out rather than sent empty.
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
