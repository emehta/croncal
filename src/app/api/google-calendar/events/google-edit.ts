/**
 * Changing and deleting Google events, a day or a series at a time. The I/O
 * half: the rules it follows, and what Google was measured to do, are in
 * lib/google-recurrence.ts. Server only, called by the update, delete and
 * series routes beside it.
 *
 * `fetchImpl` is there so a script can drive this against a real calendar
 * with a token of its own, which is how it was checked.
 */

import { createHash } from "node:crypto";
import type { GoogleEventChanges, RecurrenceEditScope, RepeatChoice } from "@/types/calendar-event";
import {
  type GoogleAttendee,
  changedFieldKeys,
  changesTiming,
  googleEventFields,
  googleEventTiming,
} from "@/app/api/google-calendar/events/google-payload";
import {
  DEFAULT_ZONE,
  type GoogleEventResource,
  type GoogleTime,
  type GoogleTiming,
  continueRecurrenceFrom,
  describeCustomRecurrence,
  endRecurrenceBefore,
  exceptionPlan,
  googleDate,
  googleTimeMs,
  instanceId,
  reanchorRecurrence,
  rebaseSeriesTiming,
  recurrenceForRepeat,
  recurrenceHasCount,
  repeatFromRecurrence,
  restoreBody,
  sameLines,
  slotAfterShift,
  timingAtSlot,
} from "@/lib/google-recurrence";
import { googleEndpoints } from "@/lib/google-endpoints";
import { GOOGLE_RECONNECT_MESSAGE } from "@/lib/google-calendar";


/** A failure with the words and status the route should answer with. */
export class GoogleEditError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleEditError";
    this.status = status;
  }
}

export type GoogleEditContext = {
  accessToken: string;
  fetchImpl?: typeof fetch;
};

type GoogleEvent = GoogleEventResource & {
  iCalUID?: string;
  eventType?: string;
  organizer?: { self?: boolean };
  attendees?: GoogleAttendee[];
  conferenceData?: unknown;
  attachments?: unknown;
  [key: string]: unknown;
};

type CallResult = { status: number; body: unknown };

/** Google's own name for why it refused: "rateLimitExceeded", "forbiddenForNonOrganizer". */
function refusalReason(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { errors?: Array<{ reason?: string }> } };
    return parsed.error?.errors?.[0]?.reason ?? "";
  } catch {
    return "";
  }
}

/**
 * Google refuses writes that come too fast for one calendar, with a 403 or a
 * 429 (measured: putting four changed days back at once tripped it). Those,
 * and its own 500s and 503s, are waited out and retried, as its guidance asks.
 */
function worthRetrying(status: number, reason: string): boolean {
  return status === 429 || status === 500 || status === 503 ||
    (status === 403 && (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"));
}

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];
/* Each attempt; a hung request fails like any other network error instead of holding the route. */
const CALL_TIMEOUT_MS = 15_000;

async function call(
  context: GoogleEditContext,
  method: string,
  path: string,
  body?: unknown,
  allow: number[] = [],
): Promise<CallResult> {
  const doFetch = context.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const response = await doFetch(`${googleEndpoints().events}${path}`, {
      method,
      headers: { Authorization: `Bearer ${context.accessToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.ok || allow.includes(response.status)) {
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      return { status: response.status, body: parsed };
    }

    const reason = refusalReason(text);
    if (worthRetrying(response.status, reason) && attempt < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    console.error(`Google ${method} ${path.split("?")[0]} failed:`, response.status, text.slice(0, 500));
    if (response.status === 401) {
      throw new GoogleEditError(GOOGLE_RECONNECT_MESSAGE, 401);
    }
    if (response.status === 403 && !worthRetrying(response.status, reason)) {
      throw new GoogleEditError("Google Calendar did not allow that change. An event someone else organises can only take its colour, type, priority and link from you.", 403);
    }
    throw new GoogleEditError("Google Calendar could not save that change. Try again in a moment.", 502);
  }
}

function eventPath(id: string, query = ""): string {
  return `/${encodeURIComponent(id)}${query}`;
}

async function getEvent(context: GoogleEditContext, id: string): Promise<GoogleEvent> {
  const { status, body } = await call(context, "GET", eventPath(id), undefined, [404, 410]);
  if (status === 404 || status === 410 || !body) {
    throw new GoogleEditError("That event is no longer in Google Calendar. Refresh the calendar.", 404);
  }
  return body as GoogleEvent;
}

function zoneOf(event: GoogleEvent): string {
  return event.start?.timeZone || DEFAULT_ZONE;
}

function timingOf(event: GoogleEvent): GoogleTiming {
  if (!event.start || !event.end) throw new GoogleEditError("Google sent that event without its times.", 502);
  return { start: event.start, end: event.end };
}

/** The new times the form sent, or null if the save does not move the event. */
function requestedTiming(changes: GoogleEventChanges): GoogleTiming | null {
  if (!changesTiming(changes)) return null;
  const timing = googleEventTiming(changes);
  if (!timing) throw new GoogleEditError("The event needs a valid start and end.", 400);
  return timing as GoogleTiming;
}

/** Every exception of a series, deleted days included: the series and its exceptions share one iCalUID. */
async function listExceptions(context: GoogleEditContext, series: GoogleEvent): Promise<GoogleEvent[]> {
  if (!series.iCalUID || !series.id) return [];
  const found: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ iCalUID: series.iCalUID, showDeleted: "true", maxResults: "2500" });
    if (pageToken) params.set("pageToken", pageToken);
    const { body } = await call(context, "GET", `?${params.toString()}`);
    const result = body as { items?: GoogleEvent[]; nextPageToken?: string } | null;
    for (const item of result?.items ?? []) {
      if (item.recurringEventId === series.id && item.originalStartTime) found.push(item);
    }
    pageToken = result?.nextPageToken;
    if (!pageToken) break;
  }
  return found;
}

/** How many of a counted series' days come before `pivot`, deleted ones included, as COUNT counts them. */
async function countDaysBefore(context: GoogleEditContext, series: GoogleEvent, pivot: GoogleTime, zone: string): Promise<number> {
  const pivotMs = googleTimeMs(pivot, zone);
  let count = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ showDeleted: "true", maxResults: "2500" });
    if (pageToken) params.set("pageToken", pageToken);
    const { body } = await call(context, "GET", eventPath(series.id ?? "", `/instances?${params.toString()}`));
    const result = body as { items?: GoogleEvent[]; nextPageToken?: string } | null;
    for (const item of result?.items ?? []) {
      const slot = item.originalStartTime ?? item.start;
      if (slot && googleTimeMs(slot, zone) < pivotMs) count++;
    }
    pageToken = result?.nextPageToken;
    if (!pageToken) break;
  }
  return count;
}

/** A series' day by its original start, for when its id is not the expected one. */
async function findInstanceId(context: GoogleEditContext, seriesId: string, slot: GoogleTime): Promise<string | null> {
  const originalStart = slot.date ?? slot.dateTime ?? "";
  const { body } = await call(
    context,
    "GET",
    eventPath(seriesId, `/instances?originalStart=${encodeURIComponent(originalStart)}&showDeleted=true`),
    undefined,
    [400, 404],
  );
  const items = (body as { items?: GoogleEvent[] } | null)?.items ?? [];
  return items[0]?.id ?? null;
}

/**
 * Puts the changed days of `oldSeries` back onto `seriesId`, which now
 * starts at `seriesStart`, each `dayShift` days on. Returns how many could
 * not be: a day the new rule no longer has, most often.
 */
async function restoreExceptions(
  context: GoogleEditContext,
  args: {
    exceptions: GoogleEvent[];
    oldSeries: GoogleEvent;
    seriesId: string;
    seriesStart: GoogleTime;
    dayShift: number;
    changed: Set<string>;
    editedSlot: GoogleTime;
    timesChanged: boolean;
    zone: string;
  },
): Promise<number> {
  const { exceptions, oldSeries, seriesId, seriesStart, dayShift, changed, editedSlot, timesChanged, zone } = args;
  const editedMs = googleTimeMs(editedSlot, zone);
  let missed = 0;

  // One at a time: written together, they trip Google's limit on one calendar.
  for (const exception of exceptions) {
    const plan = exceptionPlan(exception, oldSeries, zone);
    if (!plan) continue;
    const isEdited = googleTimeMs(plan.slot, zone) === editedMs;
    const body = restoreBody(plan, {
      changed,
      dayShift,
      keepMove: !(isEdited && timesChanged),
      seriesAllDay: Boolean(seriesStart.date),
      zone,
    });
    if (!plan.cancelled && Object.keys(body).length === 0) continue;

    /*
     * The series has already changed, so a day Google refuses is counted and
     * the rest still go back: one failure must not turn a saved change into
     * an error, nor leave the days after it unrestored.
     */
    try {
      const slot = slotAfterShift(plan.slot, dayShift, seriesStart, zone);
      let id: string | null = instanceId(seriesId, slot);
      let restored = false;
      for (let attempt = 0; attempt < 2 && id && !restored; attempt++) {
        const { status } = plan.cancelled
          ? await call(context, "DELETE", eventPath(id), undefined, [404, 410])
          : await call(context, "PATCH", eventPath(id), body, [404]);
        restored = status !== 404;
        if (!restored) id = attempt === 0 ? await findInstanceId(context, seriesId, slot) : null;
      }
      // A deleted day the new series does not have is deleted already.
      if (!restored && !plan.cancelled) missed++;
    } catch (error) {
      console.error("Putting back a changed day failed:", error);
      missed++;
    }
  }

  return missed;
}

/** What a new series copies from the one it splits from, besides its times and rule. */
const SERIES_FIELDS = [
  "summary", "description", "location", "colorId", "extendedProperties", "attendees", "reminders",
  "transparency", "visibility", "guestsCanModify", "guestsCanInviteOthers", "guestsCanSeeOtherGuests",
  "source", "conferenceData", "attachments",
] as const;

function mergeFields(series: GoogleEvent, fields: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of SERIES_FIELDS) if (series[key] !== undefined) body[key] = series[key];
  for (const [key, value] of Object.entries(fields)) {
    if (key !== "extendedProperties") body[key] = value;
  }
  const setPrivate = (fields.extendedProperties as { private?: Record<string, string | null> } | undefined)?.private;
  if (setPrivate) {
    const current = (series.extendedProperties as { private?: Record<string, string>; shared?: Record<string, string> } | undefined) ?? {};
    const merged: Record<string, string> = { ...(current.private ?? {}) };
    for (const [key, value] of Object.entries(setPrivate)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    body.extendedProperties = { ...current, private: merged };
  }
  return body;
}

export type GoogleEditResult = {
  /** Days changed on their own that could not be put back on the changed series. */
  notCarried: number;
};

/**
 * Saves `changes` to the Google event `eventId`: a one-off, or one day of a
 * series and, by `scope`, the days after it or the whole series.
 */
export async function editGoogleEvent(
  context: GoogleEditContext,
  eventId: string,
  scope: RecurrenceEditScope,
  changes: GoogleEventChanges,
): Promise<GoogleEditResult> {
  const event = await getEvent(context, eventId);
  const timing = requestedTiming(changes);
  const seriesId = event.recurringEventId;

  if (!seriesId || scope === "single") {
    const body: Record<string, unknown> = googleEventFields(changes, event.attendees ?? []);
    if (timing) Object.assign(body, timing);
    // A day of a series cannot take a rule of its own; a one-off can.
    if (changes.repeat && !seriesId) {
      const startDate = googleDate((timing ?? timingOf(event)).start, zoneOf(event));
      body.recurrence = changes.repeat === "none" ? [] : recurrenceForRepeat(changes.repeat, startDate, event.recurrence);
    }
    if (Object.keys(body).length > 0) await call(context, "PATCH", eventPath(eventId), body);
    return { notCarried: 0 };
  }

  const series = await getEvent(context, seriesId);
  const zone = zoneOf(series);
  const seriesTiming = timingOf(series);
  const dayTiming = timingOf(event);
  const pivot = event.originalStartTime ?? dayTiming.start;
  const fromFirstDay = googleTimeMs(pivot, zone) <= googleTimeMs(seriesTiming.start, zone);
  const fields = googleEventFields(changes, series.attendees ?? []);
  const changed = changedFieldKeys(fields, changes);

  if (scope === "following" && !fromFirstDay) {
    if (series.organizer?.self !== true || (series.eventType ?? "default") !== "default") {
      throw new GoogleEditError("Only a series you organise can be changed from one day onwards. Change this day or all of them.", 409);
    }
    return splitSeries(context, { series, event, pivot, timing, changes, fields, changed, zone, seriesTiming, dayTiming });
  }

  // The whole series. Fields alone Google carries to every day by itself.
  const body: Record<string, unknown> = { ...fields };

  if (changes.repeat === "none") {
    // No longer repeating: one event, where the form put it.
    Object.assign(body, timing ?? dayTiming, { recurrence: [] });
    await call(context, "PATCH", eventPath(seriesId), body);
    return { notCarried: 0 };
  }

  let dayShift = 0;
  let newStart = seriesTiming.start;
  if (timing) {
    const rebased = rebaseSeriesTiming({ slot: seriesTiming.start, from: dayTiming, to: timing, zone });
    Object.assign(body, rebased.timing);
    dayShift = rebased.dayShift;
    newStart = rebased.timing.start;
  }
  const newZone = newStart.timeZone || zone;
  const startDate = googleDate(newStart, newZone);
  const recurrence = changes.repeat
    ? recurrenceForRepeat(changes.repeat, startDate, series.recurrence)
    : reanchorRecurrence(series.recurrence, googleDate(seriesTiming.start, zone), startDate);
  if (!sameLines(recurrence, series.recurrence)) body.recurrence = recurrence;

  const reshaped = Boolean(timing) || Boolean(body.recurrence);
  // Read before the change: a new time or rule makes Google drop them.
  const exceptions = reshaped ? await listExceptions(context, series) : [];
  if (Object.keys(body).length > 0) await call(context, "PATCH", eventPath(seriesId), body);
  if (!reshaped) return { notCarried: 0 };

  const notCarried = await restoreExceptions(context, {
    exceptions,
    oldSeries: series,
    seriesId,
    seriesStart: newStart,
    dayShift,
    changed,
    editedSlot: pivot,
    timesChanged: Boolean(timing),
    zone: newZone,
  });
  return { notCarried };
}

/**
 * The id of the series a split makes, chosen here as createGoogleEvent
 * chooses one, so a POST Google carried out but answered with a 500 is found
 * on the retry (a 409) instead of made twice. It is taken from the series,
 * the day it is split at and the series' etag: asked again, the same split
 * names the same new series, and once the old series is cut short its etag
 * changes, so a later split names another. Hex is within the base32hex
 * Google takes.
 */
export function splitSeriesId(series: { id?: string; etag?: unknown; updated?: unknown }, pivotMs: number): string {
  return createHash("sha256")
    .update(`${series.id ?? ""}|${pivotMs}|${String(series.etag ?? series.updated ?? "")}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * "This and following": the series ends the day before, and a new series
 * with the change starts on this day, carrying on to where the old one would
 * have ended. The new one is made first, so a failure leaves the calendar as
 * it was rather than a series cut short with nothing after it.
 */
async function splitSeries(
  context: GoogleEditContext,
  args: {
    series: GoogleEvent;
    event: GoogleEvent;
    pivot: GoogleTime;
    timing: GoogleTiming | null;
    changes: GoogleEventChanges;
    fields: Record<string, unknown>;
    changed: Set<string>;
    zone: string;
    seriesTiming: GoogleTiming;
    dayTiming: GoogleTiming;
  },
): Promise<GoogleEditResult> {
  const { series, pivot, timing, changes, fields, changed, zone, seriesTiming, dayTiming } = args;
  const seriesId = series.id ?? "";
  const pivotMs = googleTimeMs(pivot, zone);

  // Read before the cut: ending the series cancels its exceptions after it.
  const exceptions = (await listExceptions(context, series))
    .filter((exception) => googleTimeMs(exception.originalStartTime!, zone) >= pivotMs);
  const daysBefore = recurrenceHasCount(series.recurrence) ? await countDaysBefore(context, series, pivot, zone) : 0;

  let dayShift = 0;
  let newTiming: GoogleTiming;
  if (changes.repeat === "none") {
    newTiming = timing ?? dayTiming;
  } else if (timing) {
    const rebased = rebaseSeriesTiming({ slot: pivot, from: dayTiming, to: timing, zone });
    newTiming = rebased.timing;
    dayShift = rebased.dayShift;
  } else {
    newTiming = timingAtSlot(pivot, seriesTiming, zone);
  }
  const newZone = newTiming.start.timeZone || zone;
  const startDate = googleDate(newTiming.start, newZone);
  const carried = continueRecurrenceFrom(series.recurrence, pivot, zone, daysBefore);
  const recurrence = changes.repeat === "none"
    ? []
    : changes.repeat
      ? recurrenceForRepeat(changes.repeat, startDate, carried)
      : reanchorRecurrence(carried, googleDate(pivot, zone), startDate);

  const body = mergeFields(series, fields);
  Object.assign(body, newTiming);
  if (recurrence.length > 0) body.recurrence = recurrence;

  const query = new URLSearchParams();
  if (body.conferenceData) query.set("conferenceDataVersion", "1");
  if (body.attachments) query.set("supportsAttachments", "true");
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const chosenId = splitSeriesId(series, pivotMs);
  const created = await call(context, "POST", suffix, { ...body, id: chosenId }, [409]);
  if (created.status === 409) {
    // Made by an earlier try of this split (and perhaps taken back out): it becomes this one.
    await call(context, "PUT", eventPath(chosenId, suffix), { ...body, id: chosenId, status: "confirmed" });
  }
  const newId = created.status === 409 ? chosenId : (created.body as GoogleEvent | null)?.id;
  if (!newId) throw new GoogleEditError("Google Calendar could not save that change. Try again in a moment.", 502);

  try {
    await call(context, "PATCH", eventPath(seriesId), {
      recurrence: endRecurrenceBefore(series.recurrence, pivot, zone),
    });
  } catch (error) {
    await call(context, "DELETE", eventPath(newId), undefined, [404, 410]).catch(() => {});
    throw error;
  }

  if (recurrence.length === 0) return { notCarried: 0 };
  const notCarried = await restoreExceptions(context, {
    exceptions,
    oldSeries: series,
    seriesId: newId,
    seriesStart: newTiming.start,
    dayShift,
    changed,
    editedSlot: pivot,
    timesChanged: Boolean(timing),
    zone: newZone,
  });
  return { notCarried };
}

/**
 * Adds an event to Google Calendar and returns it as Google holds it.
 *
 * The id is chosen here, not by Google. `call` retries a 500 or 503, and
 * Google can fail that way after it has made the event; with an id of its
 * own a retry finds the event already there (a 409) and returns it, where a
 * Google-chosen id would have added it twice. Google takes ids of base32hex
 * characters, which a UUID's hex digits are.
 */
export async function createGoogleEvent(
  context: GoogleEditContext,
  body: Record<string, unknown>,
): Promise<GoogleEvent> {
  const id = crypto.randomUUID().replace(/-/g, "");
  try {
    const { status, body: created } = await call(context, "POST", "", { ...body, id }, [409]);
    if (status === 409) return await getEvent(context, id);
    if (!(created as GoogleEvent | null)?.id) {
      throw new GoogleEditError("Google Calendar could not add the event. Try again in a moment.", 502);
    }
    return created as GoogleEvent;
  } catch (error) {
    // `call` words its refusals for a change to an event that exists.
    if (error instanceof GoogleEditError && error.status === 403) {
      throw new GoogleEditError("Google Calendar did not let CronCal add the event. Reconnect it in Settings.", 403);
    }
    if (error instanceof GoogleEditError && error.status === 502) {
      throw new GoogleEditError("Google Calendar could not add the event. Try again in a moment.", 502);
    }
    throw error;
  }
}

/** Deletes a one-off, one day of a series, the days from it on, or the series. */
export async function deleteGoogleEvent(
  context: GoogleEditContext,
  eventId: string,
  scope: RecurrenceEditScope,
): Promise<void> {
  if (scope === "single") {
    await call(context, "DELETE", eventPath(eventId), undefined, [404, 410]);
    return;
  }
  const event = await getEvent(context, eventId);
  const seriesId = event.recurringEventId;
  if (!seriesId) {
    await call(context, "DELETE", eventPath(eventId), undefined, [404, 410]);
    return;
  }
  const series = await getEvent(context, seriesId);
  const zone = zoneOf(series);
  const pivot = event.originalStartTime ?? timingOf(event).start;
  const fromFirstDay = googleTimeMs(pivot, zone) <= googleTimeMs(timingOf(series).start, zone);
  if (scope === "all" || fromFirstDay) {
    await call(context, "DELETE", eventPath(seriesId), undefined, [404, 410]);
    return;
  }
  await call(context, "PATCH", eventPath(seriesId), { recurrence: endRecurrenceBefore(series.recurrence, pivot, zone) });
}

/** A series' repeat as the event form shows it. */
export async function readSeriesRepeat(
  context: GoogleEditContext,
  seriesId: string,
): Promise<{ repeat: RepeatChoice; label: string | null }> {
  const series = await getEvent(context, seriesId);
  const repeat = repeatFromRecurrence(series.recurrence, googleDate(timingOf(series).start, zoneOf(series)));
  return { repeat, label: repeat === "custom" ? describeCustomRecurrence(series.recurrence) : null };
}
