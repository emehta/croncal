import { supabase } from "@/lib/supabase";
import { assertDeleted } from "@/lib/supabase-delete";
import { authedFetch } from "@/lib/authed-fetch";
import { getTimeZoneParts, zonedDateTimeToUtc } from "@/lib/calendar-timezone";
import type {
  CalendarEvent,
  GoogleEventChanges,
  RecurrenceEditScope,
  RepeatChoice,
} from "@/types/calendar-event";
import { buildGoogleEventPatch, googleCreateFields } from "@/lib/google-event-changes";
import { changedRowFields, dayTimesChanged, planSeriesMove } from "@/lib/series-edit";
import { isAbortError } from "@/lib/error-utils";
import { parseGoogleEventsResponse } from "@/lib/google-events-response";

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

function normalizeExceptionStarts(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).filter(Boolean))]
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

function splitExceptionStarts(
  values: string[] | null | undefined,
  pivotIso: string,
): { before: string[]; fromPivot: string[] } {
  const pivotMs = new Date(pivotIso).getTime();
  const before: string[] = [];
  const fromPivot: string[] = [];

  for (const value of normalizeExceptionStarts(values)) {
    if (new Date(value).getTime() < pivotMs) {
      before.push(value);
    } else {
      fromPivot.push(value);
    }
  }

  return { before, fromPivot };
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
   * Importance and type go as they are, null included. A null used to be
   * dropped from the payload, so choosing neither on an event that had one
   * left the old value in place, and the change never saved.
   */
  return payload;
}

function formatPartNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function mapOccurrenceStartToTimeZone(
  occurrenceIso: string,
  fromTimeZone: string,
  toTimeZone: string,
  targetStartIso: string,
): string {
  const occurrenceParts = getTimeZoneParts(new Date(occurrenceIso), fromTimeZone);
  const targetStartParts = getTimeZoneParts(new Date(targetStartIso), toTimeZone);
  const dateStr = `${occurrenceParts.year}-${formatPartNumber(occurrenceParts.month)}-${formatPartNumber(occurrenceParts.day)}`;
  const timeStr = `${formatPartNumber(targetStartParts.hour)}:${formatPartNumber(targetStartParts.minute)}`;
  return zonedDateTimeToUtc(dateStr, timeStr, toTimeZone, targetStartParts.second).toISOString();
}

export type { RecurrenceEditScope };
export { buildGoogleEventPatch };

export type CalendarMutationResult = {
  event: CalendarEvent;
  warning?: string;
};

async function getResponseError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return payload.error || fallback;
}

export async function fetchCalendarEvents(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<CalendarEvent[]> {
  const rangeQuery = supabase
    .from("calendar_events")
    .select("*")
    .lte("start_time", endDate)
    .gte("end_time", startDate)
    .order("start_time", { ascending: true });

  const recurringQuery = supabase
    .from("calendar_events")
    .select("*")
    .not("recurrence", "is", null)
    .order("start_time", { ascending: true });

  const [
    { data: rangeData, error: rangeError },
    { data: recurringData, error: recurringError },
  ] = await Promise.all([
    signal ? rangeQuery.abortSignal(signal) : rangeQuery,
    signal ? recurringQuery.abortSignal(signal) : recurringQuery,
  ]);

  if (rangeError) {
    if (isAbortError(rangeError)) {
      throw rangeError;
    }
    console.error("fetchCalendarEvents range query failed:", normalizeSupabaseError(rangeError));
    throw rangeError;
  }

  const rangeEvents = (rangeData as CalendarEvent[]) ?? [];

  if (recurringError) {
    if (isAbortError(recurringError)) {
      throw recurringError;
    }
    const normalized = normalizeSupabaseError(recurringError);
    const maybeLegacySchema =
      normalized.code === "42703" ||
      normalized.code === "PGRST100" ||
      `${normalized.message ?? ""} ${normalized.details ?? ""}`.toLowerCase().includes("recurrence");

    if (!maybeLegacySchema) {
      console.error("fetchCalendarEvents recurring query failed:", normalized);
    }

    return withSource(rangeEvents);
  }

  const recurringEvents = (recurringData as CalendarEvent[]) ?? [];
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

export { mergeGoogleEvents } from "@/lib/calendar-merge";

export async function fetchGoogleEvents(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ timeMin: startDate, timeMax: endDate });
  const res = await authedFetch(`/api/google-calendar/events?${params.toString()}`, { signal });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "Could not load Google Calendar events.");
  }

  // Checked here, once, for every caller; see lib/google-events-response.
  const events = parseGoogleEventsResponse(await res.json().catch(() => null));
  if (!events) throw new Error("Google Calendar sent an answer that could not be read.");
  return events;
}

/**
 * Adds an event to Google Calendar, where it then lives, and returns it as
 * the calendar shows it.
 *
 * It used to be a CronCal row with a copy sent to Google, and the copy was
 * never the same event: the repeat, type, importance and link stayed behind,
 * a day of the series changed or deleted in CronCal never reached Google, and
 * a refusal from Google left the row behind as if it were synced. The whole
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
    throw new Error(await getResponseError(res, "Google Calendar could not add the event. Try again in a moment."));
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
  originalEvent?: CalendarEvent | null,
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

  const updated = data as CalendarEvent;
  let warning: string | undefined;

  // Sync to Google if this event has a google_event_id
  if (updated.google_event_id) {
    try {
      const googlePatch = buildGoogleEventPatch(updated, originalEvent);
      if (Object.keys(googlePatch).length > 0) {
        const response = await authedFetch("/api/google-calendar/events/update", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleEventId: updated.google_event_id,
            ...googlePatch,
          }),
        });
        if (!response.ok) {
          const reason = await getResponseError(response, "Google Calendar could not update the event.");
          warning = `Updated in CronCal, but not in Google Calendar. ${reason}`;
        }
      }
    } catch (err) {
      console.error("Google sync on update failed:", err);
      warning = "Updated in CronCal, but not in Google Calendar. Check the connection in Settings and try again.";
    }
  }

  return { event: updated, warning };
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
      throw new Error(await getResponseError(res, "Could not delete that Google Calendar event."));
    }

    return;
  }

  // Delete from Google first if synced
  if (googleEventId) {
    const response = await authedFetch("/api/google-calendar/events/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleEventId }),
    });
    if (!response.ok) {
      const reason = await getResponseError(response, "Google Calendar could not delete the event.");
      throw new Error(reason);
    }
  }

  const { error: childDeleteError } = await supabase
    .from("calendar_events")
    .delete()
    .eq("recurrence_parent_id", id);

  if (childDeleteError) {
    console.error("deleteCalendarEvent child delete error:", childDeleteError);
    throw childDeleteError;
  }

  // Delete from Supabase
  const { data, error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) console.error("deleteCalendarEvent error:", error);
  assertDeleted(data, error, "event");
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
    throw new Error(await getResponseError(res, "Google Calendar could not save that change. Try again in a moment."));
  }
  const payload = await res.json().catch(() => ({})) as { notCarried?: unknown };
  return { notCarried: typeof payload.notCarried === "number" ? payload.notCarried : 0 };
}

export type GoogleSeriesRepeat = { repeat: RepeatChoice; label: string | null };

/** A Google series' repeat, which its days arrive without. */
export async function fetchGoogleSeriesRepeat(seriesId: string): Promise<GoogleSeriesRepeat> {
  const res = await authedFetch(`/api/google-calendar/events/series?seriesId=${encodeURIComponent(seriesId)}`);
  if (!res.ok) {
    throw new Error(await getResponseError(res, "Google Calendar did not send this series' repeat. Try again."));
  }
  const payload = await res.json().catch(() => null) as Partial<GoogleSeriesRepeat> | null;
  const repeats: RepeatChoice[] = ["none", "custom", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];
  if (!payload || !repeats.includes(payload.repeat as RepeatChoice)) {
    throw new Error("Google Calendar sent this series' repeat in a form CronCal could not read.");
  }
  return { repeat: payload.repeat as RepeatChoice, label: typeof payload.label === "string" ? payload.label : null };
}

export async function applyRecurringOccurrenceEdit(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
  updates: Omit<CalendarEvent, "id" | "created_at">,
): Promise<void> {
  const occurrenceIso = occurrence.start.toISOString();
  const nextExceptions = normalizeExceptionStarts([
    ...(baseEvent.recurrence_exceptions ?? []),
    occurrenceIso,
  ]);

  const { error: baseError } = await supabase
    .from("calendar_events")
    .update({ recurrence_exceptions: nextExceptions })
    .eq("id", baseEvent.id);

  if (baseError) {
    throw baseError;
  }

  const { data: existingOverride, error: existingOverrideError } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("recurrence_parent_id", baseEvent.id)
    .eq("original_occurrence_start", occurrenceIso)
    .maybeSingle();

  if (existingOverrideError) {
    throw existingOverrideError;
  }

  const overrideEvent: Omit<CalendarEvent, "id" | "created_at"> = {
    ...baseEvent,
    ...updates,
    recurrence: null,
    sync_to_google: false,
    google_event_id: null,
    recurrence_until: null,
    recurrence_exceptions: [],
    recurrence_parent_id: baseEvent.id,
    original_occurrence_start: occurrenceIso,
  };

  const payload = stripVirtualFields(overrideEvent);

  if (existingOverride) {
    const { error } = await supabase
      .from("calendar_events")
      .update(payload)
      .eq("id", existingOverride.id);

    if (error) {
      throw error;
    }
    return;
  }

  const { error } = await supabase
    .from("calendar_events")
    .insert([payload]);

  if (error) {
    throw error;
  }
}

/**
 * A change to every day of a CronCal series, saved from the form opened on one
 * of them. The form shows that day, so its times are that day's: the series
 * moves by as much as the day did (lib/series-edit), never to the day itself,
 * which would drop every day before it. Its skipped and changed days move
 * with it, and a field set for all days is set on the changed days too.
 */
export async function applyRecurringSeriesEdit(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
  updates: Omit<CalendarEvent, "id" | "created_at">,
  shown: CalendarEvent,
): Promise<CalendarMutationResult> {
  const { data: overrideRows, error: overrideError } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("recurrence_parent_id", baseEvent.id);
  if (overrideError) throw overrideError;
  const overrides = (overrideRows as CalendarEvent[] | null) ?? [];

  // No longer repeating: one event, where the form put it, and its changed days go with the series.
  if (!updates.recurrence) {
    const { error: childDeleteError } = await supabase
      .from("calendar_events")
      .delete()
      .eq("recurrence_parent_id", baseEvent.id);
    if (childDeleteError) throw childDeleteError;
    return updateCalendarEvent(baseEvent.id, { ...updates, recurrence_exceptions: [], recurrence_until: null }, baseEvent);
  }

  const carried = changedRowFields(updates, shown);
  let seriesUpdates: Partial<Omit<CalendarEvent, "id" | "created_at">> = {
    ...updates,
    start_time: baseEvent.start_time,
    end_time: baseEvent.end_time,
    all_day: baseEvent.all_day,
    timezone: baseEvent.timezone,
  };
  let rowUpdates = overrides.map((row) => ({ id: row.id, fields: carried as Partial<CalendarEvent> }));

  if (dayTimesChanged(occurrence, baseEvent, updates)) {
    const plan = planSeriesMove(baseEvent, occurrence, updates, overrides);
    seriesUpdates = { ...updates, start_time: plan.start_time, end_time: plan.end_time, recurrence_exceptions: plan.recurrence_exceptions };
    rowUpdates = plan.overrides.map(({ id, ...place }) => ({ id, fields: { ...carried, ...place } }));
  }

  const result = await updateCalendarEvent(baseEvent.id, seriesUpdates, baseEvent);
  for (const row of rowUpdates) {
    if (Object.keys(row.fields).length === 0) continue;
    const { error } = await supabase.from("calendar_events").update(row.fields).eq("id", row.id);
    if (error) throw error;
  }
  return result;
}

export async function applyRecurringFollowingEdit(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
  updates: Omit<CalendarEvent, "id" | "created_at">,
): Promise<void> {
  const occurrenceIso = occurrence.start.toISOString();
  const { before, fromPivot } = splitExceptionStarts(baseEvent.recurrence_exceptions, occurrenceIso);
  const nextTimeZone = updates.timezone ?? baseEvent.timezone;
  const preserveFutureExceptions = (updates.recurrence ?? baseEvent.recurrence) === baseEvent.recurrence;
  const nextExceptions = preserveFutureExceptions
    ? fromPivot.map((value) =>
      mapOccurrenceStartToTimeZone(value, baseEvent.timezone, nextTimeZone, updates.start_time),
    )
    : [];

  const { error: baseError } = await supabase
    .from("calendar_events")
    .update({
      recurrence_until: occurrenceIso,
      recurrence_exceptions: before,
    })
    .eq("id", baseEvent.id);

  if (baseError) {
    throw baseError;
  }

  const nextSeries: Omit<CalendarEvent, "id" | "created_at"> = {
    ...baseEvent,
    ...updates,
    recurrence: updates.recurrence ?? baseEvent.recurrence,
    recurrence_until: baseEvent.recurrence_until ?? null,
    recurrence_exceptions: nextExceptions,
    recurrence_parent_id: null,
    original_occurrence_start: null,
    google_event_id: null,
    sync_to_google: false,
  };

  const { warning } = await createCalendarEvent(nextSeries);
  if (warning) {
    console.warn(warning);
  }

  const { error: overrideDeleteError } = await supabase
    .from("calendar_events")
    .delete()
    .eq("recurrence_parent_id", baseEvent.id)
    .gte("original_occurrence_start", occurrenceIso);

  if (overrideDeleteError) {
    throw overrideDeleteError;
  }
}

export async function deleteRecurringOccurrence(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
): Promise<void> {
  const occurrenceIso = occurrence.start.toISOString();
  const nextExceptions = normalizeExceptionStarts([
    ...(baseEvent.recurrence_exceptions ?? []),
    occurrenceIso,
  ]);

  const { error: baseError } = await supabase
    .from("calendar_events")
    .update({ recurrence_exceptions: nextExceptions })
    .eq("id", baseEvent.id);

  if (baseError) {
    throw baseError;
  }

  const { error: overrideDeleteError } = await supabase
    .from("calendar_events")
    .delete()
    .eq("recurrence_parent_id", baseEvent.id)
    .eq("original_occurrence_start", occurrenceIso);

  if (overrideDeleteError) {
    throw overrideDeleteError;
  }
}

export async function deleteRecurringFollowing(
  baseEvent: CalendarEvent,
  occurrence: { start: Date; end: Date },
): Promise<void> {
  const occurrenceIso = occurrence.start.toISOString();
  const { before } = splitExceptionStarts(baseEvent.recurrence_exceptions, occurrenceIso);

  const { error } = await supabase
    .from("calendar_events")
    .update({
      recurrence_until: occurrenceIso,
      recurrence_exceptions: before,
    })
    .eq("id", baseEvent.id);

  if (error) {
    throw error;
  }

  const { error: overrideDeleteError } = await supabase
    .from("calendar_events")
    .delete()
    .eq("recurrence_parent_id", baseEvent.id)
    .gte("original_occurrence_start", occurrenceIso);

  if (overrideDeleteError) {
    throw overrideDeleteError;
  }
}
