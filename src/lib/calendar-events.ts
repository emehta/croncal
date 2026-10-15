import { supabase } from "@/lib/supabase";
import { assertDeleted } from "@/lib/supabase-delete";
import { type RangeQuery, fetchAllRows } from "@/lib/supabase-paging";
import { authedFetch } from "@/lib/authed-fetch";
import type {
  CalendarEvent,
  GoogleEventChanges,
  RecurrenceEditScope,
  RepeatChoice,
} from "@/types/calendar-event";
import { buildGoogleEventPatch, googleCreateFields } from "@/lib/google-event-changes";
import { type ChangedDayUpdate, planAllDaysEdit, planFollowingEdit } from "@/lib/series-edit";
import { isAbortError } from "@/lib/error-utils";
import { parseGoogleEventsResponse } from "@/lib/google-events-response";
import { SESSION_ERROR_CODE } from "@/lib/session-error";

type SupabaseErrorInfo = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function normalizeSupabaseError(error: unknown): SupabaseErrorInfo {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const e = error as Record<string, unknown>;
  return {
    message: typeof e.message === "string" ? e.message : undefined,
    details: typeof e.details === "string" ? e.details : undefined,
    hint: typeof e.hint === "string" ? e.hint : undefined,
    code: typeof e.code === "string" ? e.code : undefined,
  };
}

function withSource(events: CalendarEvent[]): CalendarEvent[] {
  return events.map((event) => ({ ...event, source: event.source ?? "croncal" }));
}

function stripVirtualFields(
  event: Partial<Omit<CalendarEvent, "id" | "created_at">> | CalendarEvent,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...event };
  delete payload.id;
  delete payload.created_at;
  delete payload.source;
  delete payload.google;
  /*
   * Importance and type go as they are, null included: dropped from the
   * payload, a null would leave the old value in place, so choosing neither
   * on an event that had one would never save.
   */
  return payload;
}

export type { RecurrenceEditScope };
export { buildGoogleEventPatch };

export type CalendarMutationResult = {
  event: CalendarEvent;
};

/**
 * A refusal from one of CronCal's Google routes, in its own words. `reconnect`
 * is a 401 about Google rather than about the session (lib/session-error):
 * Google no longer accepts the connection, a revoked grant above all, which
 * only connecting again fixes.
 */
export class GoogleRouteError extends Error {
  reconnect: boolean;

  constructor(message: string, reconnect: boolean) {
    super(message);
    this.name = "GoogleRouteError";
    this.reconnect = reconnect;
  }
}

async function googleRouteError(response: Response, fallback: string): Promise<GoogleRouteError> {
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  return new GoogleRouteError(payload.error || fallback, response.status === 401 && payload.code !== SESSION_ERROR_CODE);
}

/**
 * CronCal's events for a window: the one-offs and changed days in it, and the
 * series that can have a day in it (begun by its end, and not ended before
 * its start). Each read page by page (lib/supabase-paging), so a calendar
 * past PostgREST's thousand rows a response still comes back whole.
 */
export async function fetchCalendarEvents(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<CalendarEvent[]> {
  const read = (label: string, build: () => RangeQuery<CalendarEvent>) =>
    fetchAllRows(build).catch((error: unknown) => {
      if (!isAbortError(error)) console.error(`fetchCalendarEvents ${label} query failed:`, normalizeSupabaseError(error));
      throw error;
    });
  const events = () => {
    const query = supabase.from("calendar_events").select("*");
    return signal ? query.abortSignal(signal) : query;
  };

  const [rangeEvents, recurringEvents] = await Promise.all([
    read("range", () => events()
      .lte("start_time", endDate)
      .gte("end_time", startDate)
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })),
    read("recurring", () => events()
      .not("recurrence", "is", null)
      .lte("start_time", endDate)
      .or(`recurrence_until.is.null,recurrence_until.gte."${startDate}"`)
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })),
  ]);

  const merged = [...rangeEvents];
  const seenIds = new Set(rangeEvents.map((event) => event.id));

  for (const event of recurringEvents) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    merged.push(event);
  }

  merged.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return withSource(merged);
}

export async function fetchGoogleEvents(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ timeMin: startDate, timeMax: endDate });
  const res = await authedFetch(`/api/google-calendar/events?${params.toString()}`, { signal });

  if (!res.ok) throw await googleRouteError(res, "Could not load Google Calendar events.");

  // Checked here, once, for every caller; see lib/google-events-response.
  const events = parseGoogleEventsResponse(await res.json().catch(() => null));
  if (!events) throw new Error("Google Calendar sent an answer that could not be read.");
  return events;
}

/**
 * Adds an event to Google Calendar, where it then lives, and returns it as
 * the calendar shows it.
 *
 * Not a CronCal row with a copy sent to Google, which is never the same
 * event: the repeat, type, importance and link would stay behind, and a
 * refusal from Google would leave the row as if it were synced. The whole
 * schedule lives in Google, so a new event does too, and every edit, drag
 * and deletion of it takes the path every other Google event takes.
 *
 * Throws with Google's reason, so the form stays open and says why.
 */
export async function createGoogleCalendarEvent(
  event: Omit<CalendarEvent, "id" | "created_at">,
): Promise<CalendarEvent> {
  const res = await authedFetch("/api/google-calendar/events/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(googleCreateFields(event)),
  });
  if (!res.ok) {
    throw await googleRouteError(res, "Google Calendar could not add the event. Try again in a moment.");
  }
  const payload = await res.json().catch(() => null) as { event?: CalendarEvent } | null;
  if (!payload?.event?.google_event_id) {
    throw new Error("Google Calendar added the event but sent back an answer CronCal could not read. Refresh the calendar.");
  }
  return payload.event;
}

/**
 * A new event: in Google Calendar when the form's Google switch is on (see
 * createGoogleCalendarEvent), otherwise a CronCal row of its own.
 */
export async function createCalendarEvent(
  event: Omit<CalendarEvent, "id" | "created_at">
): Promise<CalendarMutationResult> {
  if (event.sync_to_google) {
    return { event: await createGoogleCalendarEvent(event) };
  }

  const payload = stripVirtualFields(event);

  const { data, error } = await supabase
    .from("calendar_events")
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error("createCalendarEvent error:", {
      ...normalizeSupabaseError(error),
      payload,
    });
    throw error;
  }

  return { event: data as CalendarEvent };
}

/**
 * A CronCal event moved into Google Calendar, with the form's changes: made in
 * Google first, and its CronCal row removed only once Google has it, so a
 * failure leaves the event where it was. If the row cannot be removed, the
 * Google copy is taken back out, so the event never shows twice.
 */
export async function moveCalendarEventToGoogle(
  localId: string,
  event: Omit<CalendarEvent, "id" | "created_at">,
): Promise<CalendarEvent> {
  const created = await createGoogleCalendarEvent(event);

  const { data, error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", localId)
    .select("id");
  try {
    assertDeleted(data, error, "event");
  } catch (deleteError) {
    console.error("Removing the CronCal copy after the move to Google failed:", deleteError);
    const undo = await authedFetch("/api/google-calendar/events/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleEventId: created.google_event_id }),
    }).catch(() => null);
    throw new Error(undo?.ok
      ? "Could not move the event to Google Calendar: CronCal could not remove its own copy. Nothing was changed."
      : "The event was added to Google Calendar, but CronCal could not remove its own copy, so it shows twice. Delete the one without the Google mark.");
  }
  return created;
}

export async function updateCalendarEvent(
  id: string,
  updates: Partial<Omit<CalendarEvent, "id" | "created_at">>,
): Promise<CalendarMutationResult> {
  const payload = stripVirtualFields(updates);

  const { data, error } = await supabase
    .from("calendar_events")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("updateCalendarEvent error:", error);
    throw error;
  }

  return { event: data as CalendarEvent };
}

export async function deleteCalendarEvent(
  id: string,
  googleEventId?: string | null,
  scope: RecurrenceEditScope = "single",
): Promise<void> {
  // A Google event lives only in Google; `scope` says which days of its series.
  if (id.startsWith("google_")) {
    const realGoogleId = googleEventId || id.replace("google_", "");
    const res = await authedFetch("/api/google-calendar/events/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleEventId: realGoogleId, scope }),
    });

    if (!res.ok) {
      throw await googleRouteError(res, "Could not delete that Google Calendar event.");
    }

    return;
  }

  // The event and its changed days together (supabase/schema.sql).
  const { data, error } = await supabase.rpc("croncal_delete_event", { p_event: id });
  if (error) console.error("deleteCalendarEvent error:", error);
  assertDeleted(typeof data === "number" && data > 0 ? [id] : [], error, "event");
}

export type GoogleSaveResult = {
  /** Days changed on their own that the changed series no longer has. */
  notCarried: number;
};

/**
 * Saves `changes` to a Google event, and with `scope` to the days of its
 * series after it or to all of them. Throws with Google's reason, so the form
 * can say why a save did not happen instead of closing as if it had.
 */
export async function updateGoogleEvent(
  googleEventId: string,
  changes: GoogleEventChanges,
  scope: RecurrenceEditScope = "single",
): Promise<GoogleSaveResult> {
  const res = await authedFetch("/api/google-calendar/events/update", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ googleEventId, scope, ...changes }),
  });
  if (!res.ok) {
    throw await googleRouteError(res, "Google Calendar could not save that change. Try again in a moment.");
  }
  const payload = await res.json().catch(() => ({})) as { notCarried?: unknown };
  return { notCarried: typeof payload.notCarried === "number" ? payload.notCarried : 0 };
}

export type GoogleSeriesRepeat = { repeat: RepeatChoice; label: string | null };

/** A Google series' repeat, which its days arrive without. */
export async function fetchGoogleSeriesRepeat(seriesId: string): Promise<GoogleSeriesRepeat> {
  const res = await authedFetch(`/api/google-calendar/events/series?seriesId=${encodeURIComponent(seriesId)}`);
  if (!res.ok) {
    throw await googleRouteError(res, "Google Calendar did not send this series' repeat. Try again.");
  }
  const payload = await res.json().catch(() => null) as Partial<GoogleSeriesRepeat> | null;
  const repeats: RepeatChoice[] = ["none", "custom", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];
  if (!payload || !repeats.includes(payload.repeat as RepeatChoice)) {
    throw new Error("Google Calendar sent this series' repeat in a form CronCal could not read.");
  }
  return { repeat: payload.repeat as RepeatChoice, label: typeof payload.label === "string" ? payload.label : null };
}

/** What a write sends of an event: its own fields, without the id, creation time or what only the page knows. */
function rowFields(event: Partial<CalendarEvent>): Record<string, unknown> {
  return stripVirtualFields(event as Partial<Omit<CalendarEvent, "id" | "created_at">>);
}

/** A series' changed days: the rows that each replace one of its days. */
async function readChangedDays(seriesId: string): Promise<CalendarEvent[]> {
  return fetchAllRows<CalendarEvent>(() => supabase
    .from("calendar_events")
    .select("*")
    .eq("recurrence_parent_id", seriesId)
    .order("original_occurrence_start", { ascending: true })
    .order("id", { ascending: true }));
}

function dayUpdates(days: ChangedDayUpdate[]): { id: string; fields: Record<string, unknown> }[] {
  return days.map((day) => ({ id: day.id, fields: rowFields(day.fields) }));
}

/** A day of a series as the form showed it, when the caller has no other: the series at that day's times. */
function seriesDay(series: CalendarEvent, day: { start: Date; end: Date }): CalendarEvent {
  return { ...series, start_time: day.start.toISOString(), end_time: day.end.toISOString() };
}

/*
 * Every change below that touches a series and its changed days together is
 * one call to a function in supabase/schema.sql, which runs as one
 * transaction: it happens whole or not at all, and the same call sent again
 * changes nothing more. What changes is worked out here (lib/series-edit),
 * from the series as the page has it, so a retry sends the same thing.
 */

/** One day of a CronCal series changed on its own: `updates` at that day's place. */
export async function applyRecurringOccurrenceEdit(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
  updates: Omit<CalendarEvent, "id" | "created_at">,
): Promise<void> {
  const { error } = await supabase.rpc("croncal_change_day", {
    p_series: baseEvent.id,
    p_place: occurrence.start.toISOString(),
    p_fields: rowFields(updates),
  });
  if (error) throw error;
}

/**
 * A change to every day of a CronCal series, saved from the form opened on one
 * of them (`shown`, as the form showed it). The form shows that day, so its
 * times are that day's: the series moves by as much as the day did
 * (lib/series-edit), never to the day itself, which would drop every day
 * before it. Its skipped and changed days move with it, and a field set for
 * all days is set on the changed days too.
 */
export async function applyRecurringSeriesEdit(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
  updates: Omit<CalendarEvent, "id" | "created_at">,
  shown: CalendarEvent = seriesDay(baseEvent, occurrence),
): Promise<void> {
  const plan = planAllDaysEdit(baseEvent, shown, updates, await readChangedDays(baseEvent.id));
  const { error } = await supabase.rpc("croncal_change_series", {
    p_series: baseEvent.id,
    p_fields: rowFields(plan.fields),
    p_days: dayUpdates(plan.days),
    p_drop_days: plan.dropDays,
  });
  if (error) throw error;
}

/**
 * A change to a CronCal series from one day on: the series is split there
 * (lib/series-edit planFollowingEdit). `newSeriesId` names the new series, so
 * the same save sent again finds it made rather than making a second.
 */
export async function applyRecurringFollowingEdit(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
  updates: Omit<CalendarEvent, "id" | "created_at">,
  shown: CalendarEvent = seriesDay(baseEvent, occurrence),
  newSeriesId: string = crypto.randomUUID(),
): Promise<void> {
  const plan = planFollowingEdit(baseEvent, occurrence, shown, updates, await readChangedDays(baseEvent.id));
  const { error } = await supabase.rpc("croncal_split_series", {
    p_series: baseEvent.id,
    p_pivot: occurrence.start.toISOString(),
    p_new: { ...rowFields(plan.next), id: newSeriesId },
    p_days: dayUpdates(plan.days),
  });
  if (error) throw error;
}

/** One day of a CronCal series deleted: skipped, and its changed copy, if any, gone. */
export async function deleteRecurringOccurrence(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
): Promise<void> {
  const { error } = await supabase.rpc("croncal_delete_day", {
    p_series: baseEvent.id,
    p_place: occurrence.start.toISOString(),
  });
  if (error) throw error;
}

/** A CronCal series from one day on deleted: it ends the day before, or, from its first day, goes. */
export async function deleteRecurringFollowing(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
): Promise<void> {
  const { error } = await supabase.rpc("croncal_delete_following", {
    p_series: baseEvent.id,
    p_pivot: occurrence.start.toISOString(),
  });
  if (error) throw error;
}
