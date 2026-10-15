"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import CalendarHeader from "@/components/calendar/CalendarHeader";
import TimeGrid from "@/components/calendar/TimeGrid";
import MonthGrid from "@/components/calendar/MonthGrid";
import CalendarSidebar from "@/components/calendar/CalendarSidebar";
import EventFormPanel from "@/components/calendar/EventFormPanel";
import EventDetailPanel from "@/components/calendar/EventDetailPanel";
import ScopePicker from "@/components/calendar/ScopePicker";
import { CalendarEvent } from "@/types/calendar-event";
import {
  fetchCalendarEvents,
  fetchGoogleEvents,
  createCalendarEvent,
  moveCalendarEventToGoogle,
  updateCalendarEvent,
  deleteCalendarEvent,
  updateGoogleEvent,
  buildGoogleEventPatch,
  applyRecurringOccurrenceEdit,
  applyRecurringFollowingEdit,
  applyRecurringSeriesEdit,
  deleteRecurringOccurrence,
  deleteRecurringFollowing,
  fetchGoogleSeriesRepeat,
  GoogleRouteError,
  type GoogleSeriesRepeat,
  type RecurrenceEditScope,
} from "@/lib/calendar-events";
import StatusBanner from "@/components/StatusBanner";
import { DialogButton } from "@/components/form/Dialog";
import LoadingState from "@/components/LoadingState";
import { resolveWeekWindow } from "@/lib/calendar-range";
import { getErrorMessage, isAbortError } from "@/lib/error-utils";
import { authedFetch } from "@/lib/authed-fetch";
import { GOOGLE_CHANGED_EVENT } from "@/lib/open-settings";
import type { GoogleStatusPayload } from "@/app/api/auth/google/status/route";
import { rememberConnection, rememberedConnection } from "@/lib/connection-memory";
import { CALENDAR_COLUMN_GAP, UNDER_DOCK_MARGIN } from "@/lib/styles";
import { usePhone } from "@/lib/use-viewport-width";
import { eventChanges, placeOfChangedDay, scopeOptions } from "@/lib/series-edit";
import {
  cacheGeneration,
  invalidateEventCache,
  isFresh,
  readEventCache,
  writeEventCache,
} from "@/lib/page-cache";
import { countSpans } from "@/lib/event-days";
import { useToday } from "@/lib/use-today";
import { useWeekStart } from "@/lib/week-start";
import { fromDateStr, shiftDateStr, startOfMonth } from "@/lib/date-utils";

// ─── Date range helpers ──────────────────────────────────────────────

/**
 * The window of events to hold in memory for a view.
 *
 * Whole months on purpose. The day grid reports the left-hand day as you
 * scroll, so a window slid along by the day would be a new cache key, and a
 * miss, for every day dragged past.
 *
 * Snapped to month edges, scrolling anywhere inside the current month leaves
 * the key untouched, and crossing into the next one changes it once, to a
 * window the adjacent prefetch has already warmed.
 */
function getDateRange(currentDate: Date): { start: Date; end: Date } {
  /*
   * Three whole months, anchored on the month you are in rather than slid
   * along by the day. Anchoring is what makes the key stable: the window
   * depends only on which month currentDate falls in, so it is identical for
   * every day of that month instead of shifting under each one.
   *
   * Every view takes the same window: month view scrolls continuously
   * through the months, so the weeks either side of a boundary need theirs
   * too.
   */
  const start = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toISODate(date: Date): string {
  return date.toISOString();
}

type CalendarView = "day" | "week" | "month";

/**
 * "checking" is a real state, not an absence of one.
 *
 * The sidebar draws nothing for "disconnected", so from there the Google row
 * would appear only once the status round trip came back, well after the
 * rest of the page, shoving the layout as it arrived. The round trip is slow
 * for a reason: it refreshes the token and asks Google whether the calendar
 * scope is still granted, which is two calls out. So the row is drawn from
 * the first paint and fills in.
 */
type GoogleCalendarStatus = "checking" | "connected" | "disconnected" | "reconnect";

type EventRangeDescriptor = {
  view: CalendarView;
  currentDate: Date;
  startIso: string;
  endIso: string;
  googleEnabled: boolean;
  cacheKey: string;
};

/* The windows a prefetch is already fetching; the events themselves are in lib/page-cache. */
const prefetchInFlight = new Set<string>();

function getEventCacheKey(view: CalendarView, startIso: string, endIso: string, googleEnabled: boolean): string {
  return `${view}:${startIso}:${endIso}:google-${googleEnabled ? "on" : "off"}`;
}

function buildEventRangeDescriptor(
  view: CalendarView,
  currentDate: Date,
  googleEnabled: boolean,
): EventRangeDescriptor {
  const { start, end } = getDateRange(currentDate);
  const startIso = toISODate(start);
  const endIso = toISODate(end);
  return {
    view,
    currentDate: new Date(currentDate),
    startIso,
    endIso,
    googleEnabled,
    cacheKey: getEventCacheKey(view, startIso, endIso, googleEnabled),
  };
}

/**
 * The date whose window sits next to this one.
 *
 * A month in every view, because that is the size of a window: stepping a
 * day or a week would land inside the same month and prefetch the range
 * already on screen, leaving the real neighbour cold.
 */
function getAdjacentDate(currentDate: Date, direction: -1 | 1): Date {
  const next = new Date(currentDate);
  next.setDate(1);
  next.setMonth(next.getMonth() + direction);
  return next;
}

function scheduleIdleTask(callback: () => void): void {
  if (typeof window === "undefined") return;

  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(callback, { timeout: 1500 });
    return;
  }

  window.setTimeout(callback, 250);
}

function waitForScrollEnd(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    function handleAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

type CalendarOccurrenceSelection = {
  start: Date;
  end: Date;
};

/**
 * One day of a series, which a change, drag or deletion asks about: the
 * series, which of its days (its place, as the series names it), and the day
 * as the form shows it.
 *
 * A day of a CronCal series is the series drawn on that day. A day changed on
 * its own is a row of its own but still a day of its series, at the place it
 * took over, with the series' repeat. A day of a Google series comes from
 * Google expanded, with an id of its own, and is what every Google route
 * takes. Taken for a one-off, a change to any of these would change that day
 * alone without asking.
 */
type SeriesDay = {
  series: CalendarEvent;
  occurrence: CalendarOccurrenceSelection;
  shown: CalendarEvent;
};

/** The series day `event` is, from the day the grid says was clicked, or null for a one-off. */
function seriesDayOf(
  event: CalendarEvent,
  selected: CalendarOccurrenceSelection | null | undefined,
  events: readonly CalendarEvent[],
): SeriesDay | null {
  // Opened without a day, a Google day is its own, and a CronCal series' its first.
  const day = selected ?? { start: new Date(event.start_time), end: new Date(event.end_time) };
  if (event.google?.seriesId) return { series: event, occurrence: day, shown: event };
  if (event.recurrence) {
    return { series: event, occurrence: day, shown: { ...event, start_time: day.start.toISOString(), end_time: day.end.toISOString() } };
  }
  const series = event.recurrence_parent_id ? events.find((entry) => entry.id === event.recurrence_parent_id && entry.recurrence) : null;
  const place = series ? placeOfChangedDay(series, event) : null;
  return series && place ? { series, occurrence: place, shown: { ...event, recurrence: series.recurrence } } : null;
}

/** The scope a Google save is sent with: a one-off has only itself. */
function googleScope(event: CalendarEvent, scope: RecurrenceEditScope): RecurrenceEditScope {
  return event.google?.seriesId ? scope : "single";
}

/** What a save says when changed days could not follow their series. */
function notCarriedWarning(count: number): string {
  return count === 1
    ? "Saved. One day you had edited on its own isn't in the new pattern, so its edits were dropped."
    : `Saved. ${count} days you had edited on their own aren't in the new pattern, so their edits were dropped.`;
}

/**
 * A save, drag or deletion of a repeating event, waiting on which days it is
 * for. Asked after the fact, once there is a change to apply, not before the
 * form, when nothing has been changed yet.
 */
type ScopeRequest = {
  action: "save" | "delete" | "move";
  day: SeriesDay;
  options: RecurrenceEditScope[];
  /** For a save: what the form sent, and the day as the form showed it. */
  save?: { eventData: Omit<CalendarEvent, "id" | "created_at">; shown: CalendarEvent };
  /** For a move: where the dragged day was dropped. */
  moveTo?: CalendarOccurrenceSelection;
  /** Asked over the event form, which closes with it once it is answered. */
  fromForm: boolean;
  /** Names what this request makes, so pressing again after a failure cannot make it twice. */
  requestId: string;
};

const SCOPE_TITLES: Record<ScopeRequest["action"], string> = {
  save: "Edit repeating event",
  delete: "Delete repeating event",
  move: "Move repeating event",
};

/** An event's own fields, without the row's id and creation time. */
function eventFields(event: CalendarEvent): Omit<CalendarEvent, "id" | "created_at"> {
  const { id: _id, created_at: _createdAt, ...fields } = event;
  return fields;
}

/**
 * The event form, open on one event. For a day of a series that is the day
 * itself, whichever days the change turns out to be for.
 */
type EditingContext = {
  originalEvent: CalendarEvent;
  draftEvent: CalendarEvent;
  day: SeriesDay | null;
};

/** A Google series' repeat, for the form: being read, read, or not readable. */
type SeriesRepeatState = GoogleSeriesRepeat | "loading" | "failed" | null;

// ─── Component ───────────────────────────────────────────────────────

export default function CalendarPage() {
  const [view, setView] = useState<CalendarView>("week");
  const phone = usePhone();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  /** The week grid's first column, as it reports it. Null until it has. */
  const [visibleStart, setVisibleStart] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  /*
   * The occurrence a click selected (lib/calendar-selection), drawn solid on
   * the grid. Its card opens on a double click; `selectedEvent` is that card.
   */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<CalendarOccurrenceSelection | null>(null);
  const [editingContext, setEditingContext] = useState<EditingContext | null>(null);
  const [creatingEvent, setCreatingEvent] = useState<Partial<CalendarEvent> | null>(null);
  const [scopeRequest, setScopeRequest] = useState<ScopeRequest | null>(null);
  const [scopeChoice, setScopeChoice] = useState<RecurrenceEditScope>("single");
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState("");
  /*
   * A Google series' repeat, asked for as soon as one of its days is clicked
   * and kept while its dialogs are open: the days come without it, and the
   * form's Repeats needs it. `editingSeries` is the series the form is open
   * on, so an answer that arrives after the form moved on is dropped.
   */
  const [seriesRepeatState, setSeriesRepeatState] = useState<SeriesRepeatState>(null);
  const seriesRepeatRequests = useRef(new Map<string, Promise<GoogleSeriesRepeat>>());
  const seriesRepeatAnswers = useRef(new Map<string, GoogleSeriesRepeat>());
  const editingSeries = useRef<string | null>(null);
  /*
   * The last known answer, so the first fetch asks Google straight away. From
   * false, the first load would be local only, and Google's events would
   * arrive a status check, a scroll wait and a second local query later.
   */
  const [googleConnected, setGoogleConnected] = useState(() => rememberedConnection("google"));
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus>("checking");
  const [showGoogleEvents, setShowGoogleEvents] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  // A save that worked but has something to say, or a connect that worked: not an error.
  const [notice, setNotice] = useState<{ tone: "success" | "info"; message: string } | null>(null);
  const [reconnectingGoogle, setReconnectingGoogle] = useState(false);
  const [firstLoadError, setFirstLoadError] = useState("");
  const [coldLoadingEvents, setColdLoadingEvents] = useState(true);
  /* Whether anything has ever been rendered, which decides blank vs stale. */
  const hasLoadedOnceRef = useRef(false);
  const eventAbortRef = useRef<AbortController | null>(null);
  const firstEventFetchRef = useRef(true);
  const googleEventsEnabled = googleConnected && showGoogleEvents;
  /*
   * The window is a function of the month, so the month is what it is built
   * from. Passing currentDate straight in would make a new descriptor for
   * every day, so a new loadEvents, so the fetch effect would re-run on every
   * day scrolled past, aborting the request in flight each time, for the same
   * window.
   */
  const rangeMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const rangeAnchor = useMemo(() => {
    const [year, month] = rangeMonthKey.split("-").map(Number);
    return new Date(year, month, 1);
  }, [rangeMonthKey]);
  const eventRange = useMemo(
    () => buildEventRangeDescriptor(view, rangeAnchor, googleEventsEnabled),
    [googleEventsEnabled, rangeAnchor, view],
  );

  // ─── Check Google connection ─────────────────────────────────────

  useEffect(() => {
    /*
     * Read the outcome the OAuth callback redirected back with, then strip it
     * from the URL so a refresh does not replay the message. Done here rather
     * than through useSearchParams so this page can stay statically rendered.
     */
    function readConnectOutcome(): string {
      if (typeof window === "undefined") return "";
      const outcome = new URLSearchParams(window.location.search).get("google");
      if (!outcome) return "";

      const url = new URL(window.location.href);
      url.searchParams.delete("google");
      window.history.replaceState({}, "", url.toString());

      switch (outcome) {
        case "connected":
          setNotice({ tone: "success", message: "Google Calendar connected." });
          return "";
        case "denied":
          return "Could not connect Google Calendar: access was declined. Connect again in Settings and allow calendar access.";
        case "scope_missing":
          return "Could not connect Google Calendar: calendar access wasn't ticked. Connect again in Settings and tick it.";
        case "client":
          return "Google refused the client. Check its ID and secret in Settings, under Google Calendar.";
        case "expired":
          return "The connection took too long. Connect again in Settings.";
        default:
          return "Could not finish connecting to Google. Try again from Settings in a moment.";
      }
    }

    async function checkGoogle() {
      const outcomeMessage = readConnectOutcome();
      if (outcomeMessage) setErrorMessage(outcomeMessage);

      try {
        const response = await authedFetch("/api/auth/google/status");
        const payload = await response.json().catch(() => ({})) as Partial<GoogleStatusPayload>;

        if (!response.ok) {
          throw new Error(payload.error || "Could not verify Google Calendar connection.");
        }

        const connected = Boolean(payload.connected);
        setGoogleConnected(connected);
        rememberConnection("google", connected);

        if (connected) {
          setGoogleStatus("connected");
        } else {
          setGoogleStatus(payload.needsReconnect ? "reconnect" : "disconnected");
          setShowGoogleEvents(false);
        }
      } catch (error) {
        setGoogleStatus("disconnected");
        /*
         * Do not bury the reason a connection attempt just failed under a
         * generic "could not verify": the specific one is the useful one, and
         * a failed attempt usually makes the status check fail too.
         */
        if (!outcomeMessage) {
          setErrorMessage(getErrorMessage(error, "Could not verify Google Calendar connection."));
        }
      }
    }
    void checkGoogle();
    // Settings connects and disconnects without leaving the page.
    const recheck = () => { void checkGoogle(); };
    window.addEventListener(GOOGLE_CHANGED_EVENT, recheck);
    return () => window.removeEventListener(GOOGLE_CHANGED_EVENT, recheck);
  }, []);

  /* A Google refusal that only connecting again fixes: shown as the Reconnect row, with Google's events put away. */
  const showGoogleReconnect = useCallback(() => {
    setGoogleConnected(false);
    rememberConnection("google", false);
    setGoogleStatus("reconnect");
    setShowGoogleEvents(false);
  }, []);

  // ─── Fetch events ────────────────────────────────────────────────

  const fetchEventsForRange = useCallback(async (
    range: EventRangeDescriptor,
    signal: AbortSignal,
    options: { surfaceGoogleErrors: boolean },
  ): Promise<CalendarEvent[]> => {
    /*
     * Both requests start together. They are independent, and asking Google
     * only once the local query answered would put one round trip after the
     * other on every load. The catch only keeps an early local failure from
     * leaving this promise unhandled; it is awaited, errors and all, below.
     */
    const googleRequest = range.googleEnabled
      ? fetchGoogleEvents(range.startIso, range.endIso, signal)
      : null;
    googleRequest?.catch(() => {});
    // Noted now: an event changed while these are out makes them stale (lib/page-cache).
    const startedAt = cacheGeneration();

    const localEvents = await fetchCalendarEvents(range.startIso, range.endIso, signal);
    writeEventCache(getEventCacheKey(range.view, range.startIso, range.endIso, false), range.startIso, range.endIso, localEvents, startedAt);

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (!googleRequest) {
      return localEvents;
    }

    /*
     * Nothing is drawn until Google has answered too: the two arrive as one,
     * so a CronCal event never sits alone in an empty week while the schedule
     * appears around it a moment later. Both requests are already in flight, so this costs no time: the grid
     * fills when Google's events would have arrived anyway.
     */
    try {
      const googleEvents = await googleRequest;
      const merged = [...localEvents, ...googleEvents];
      writeEventCache(range.cacheKey, range.startIso, range.endIso, merged, startedAt);
      return merged;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      // Google no longer accepts the connection (a revoked grant): the sidebar's Reconnect row says so.
      if (error instanceof GoogleRouteError && error.reconnect) {
        showGoogleReconnect();
        return localEvents;
      }
      if (options.surfaceGoogleErrors) {
        setErrorMessage(getErrorMessage(error, "Google Calendar couldn't be loaded. Reconnect it in Settings if this keeps happening."));
      }
      return localEvents;
    }
  }, [showGoogleReconnect]);

  const prefetchRange = useCallback((range: EventRangeDescriptor) => {
    const cached = readEventCache(range.cacheKey);
    if (isFresh(cached) || prefetchInFlight.has(range.cacheKey)) return;

    prefetchInFlight.add(range.cacheKey);
    scheduleIdleTask(() => {
      if (isFresh(readEventCache(range.cacheKey))) {
        prefetchInFlight.delete(range.cacheKey);
        return;
      }

      const controller = new AbortController();
      fetchEventsForRange(range, controller.signal, {
        surfaceGoogleErrors: false,
      }).catch((error) => {
        if (!isAbortError(error)) {
          console.warn("Calendar prefetch failed:", error);
        }
      }).finally(() => {
        prefetchInFlight.delete(range.cacheKey);
      });
    });
  }, [fetchEventsForRange]);

  const prefetchAdjacentRanges = useCallback((range: EventRangeDescriptor) => {
    prefetchRange(buildEventRangeDescriptor(
      range.view,
      getAdjacentDate(range.currentDate, -1),
      range.googleEnabled,
    ));
    prefetchRange(buildEventRangeDescriptor(
      range.view,
      getAdjacentDate(range.currentDate, 1),
      range.googleEnabled,
    ));
  }, [prefetchRange]);

  const loadEvents = useCallback(async (options?: { force?: boolean; deferNetwork?: boolean }) => {
    const force = options?.force ?? false;
    const deferNetwork = options?.deferNetwork ?? false;
    const cached = readEventCache(eventRange.cacheKey);
    const fresh = isFresh(cached);

    eventAbortRef.current?.abort();

    if (cached) {
      setEvents(cached.events);
      hasLoadedOnceRef.current = true;
      setColdLoadingEvents(false);
    } else if (!hasLoadedOnceRef.current) {
      // Nothing has ever been on screen, so there is nothing to keep.
      setEvents([]);
      setColdLoadingEvents(true);
    }
    /*
     * Otherwise the previous window stays up while the new one loads. Blanked,
     * a scroll that crossed a boundary would empty the grid and put a loader
     * over it for the length of a round trip, which reads as the calendar
     * breaking rather than fetching. The windows overlap anyway.
     */

    if (!force && fresh) {
      prefetchAdjacentRanges(eventRange);
      return;
    }

    const controller = new AbortController();
    eventAbortRef.current = controller;

    try {
      if (deferNetwork) {
        await waitForScrollEnd(150, controller.signal);
      }

      const freshEvents = await fetchEventsForRange(eventRange, controller.signal, {
        surfaceGoogleErrors: true,
      });

      if (controller.signal.aborted) return;
      setEvents(freshEvents);
      hasLoadedOnceRef.current = true;
      setColdLoadingEvents(false);
      setFirstLoadError("");
      prefetchAdjacentRanges(eventRange);
    } catch (error) {
      if (isAbortError(error)) return;
      setColdLoadingEvents(false);
      const message = getErrorMessage(error, "Could not load your events.");
      // Nothing on screen yet: the grid says so, with Try again, rather than drawing an empty week.
      if (hasLoadedOnceRef.current) setErrorMessage(message);
      else setFirstLoadError(message);
    } finally {
      if (eventAbortRef.current === controller) {
        eventAbortRef.current = null;
      }
    }
  }, [eventRange, fetchEventsForRange, prefetchAdjacentRanges]);

  useEffect(() => {
    const deferNetwork = !firstEventFetchRef.current;
    firstEventFetchRef.current = false;
    loadEvents({ deferNetwork });

    return () => {
      eventAbortRef.current?.abort();
    };
  }, [loadEvents]);

  /*
   * A selected event is put down by Escape, or by a press anywhere off the
   * calendar: the grids put it down themselves for a press inside them.
   * Never while a card is open: its Escape closes the card and leaves the
   * event selected. Both listen in the capture phase, so they see the key
   * while the card is still there to be seen (the card does not mark the
   * Escape it handles, and closing it can re-run this before the same
   * keypress reaches a listener added afterwards).
   */
  useEffect(() => {
    if (selectedKey === null) return;
    const cardOpen = () => document.querySelector('[role="dialog"]') !== null;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || cardOpen()) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      setSelectedKey(null);
    }
    function onPress(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target || cardOpen() || target.closest("[data-calendar-surface]")) return;
      setSelectedKey(null);
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [selectedKey]);

  // ─── The sidebar's counts ────────────────────────────────────────

  /*
   * Today, this week and this month: of the real today, not of the month on
   * screen, and turning over at midnight. Read from the events on screen when
   * their window holds those days, and otherwise from today's own window,
   * cached or loaded beside it. Read again whenever the events on screen are,
   * so a save shows in the counts too.
   */
  const today = useToday();
  const weekStart = useWeekStart();
  const spans = useMemo(() => countSpans(today, weekStart), [today, weekStart]);
  const countFirst = spans.week.first < spans.month.first ? spans.week.first : spans.month.first;
  const countLast = spans.week.last > spans.month.last ? spans.week.last : spans.month.last;
  const screenHoldsCounts = new Date(eventRange.startIso).getTime() <= fromDateStr(countFirst).getTime() &&
    new Date(eventRange.endIso).getTime() >= fromDateStr(shiftDateStr(countLast, 1)).getTime() - 1;
  const todayRange = useMemo(
    () => buildEventRangeDescriptor(view, startOfMonth(fromDateStr(today)), googleEventsEnabled),
    [googleEventsEnabled, today, view],
  );
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    if (screenHoldsCounts) return;
    const cached = readEventCache(todayRange.cacheKey);
    if (cached) setTodayEvents(cached.events);
    if (isFresh(cached)) return;
    const controller = new AbortController();
    fetchEventsForRange(todayRange, controller.signal, { surfaceGoogleErrors: false }).then(
      (loaded) => { if (!controller.signal.aborted) setTodayEvents(loaded); },
      (error) => { if (!isAbortError(error)) console.warn("Loading today's events for the counts failed:", error); },
    );
    return () => controller.abort();
  }, [events, fetchEventsForRange, screenHoldsCounts, todayRange]);

  // ─── Event handlers ──────────────────────────────────────────────

  function handleEventOpen(event: CalendarEvent, occurrence?: { start: Date; end: Date }) {
    setSelectedEvent(event);
    setSelectedOccurrence(occurrence ?? null);
    // Asked now, so a series' repeat is usually in before Edit is pressed.
    if (event.google?.seriesId) void seriesRepeat(event.google.seriesId).catch(() => {});
  }

  function handleSlotSelect(start: Date, end: Date) {
    setCreatingEvent({
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    });
  }

  function handleDateClickFromMonth(date: Date) {
    setView("day");
    setCurrentDate(date);
  }

  /** Send the user to Google to grant calendar access again. */
  async function startGoogleConnection() {
    setReconnectingGoogle(true);
    try {
      setErrorMessage("");
      const response = await authedFetch("/api/auth/google?connect=true");
      const body = await response.json().catch(() => ({})) as { error?: string; url?: string };

      if (!response.ok || !body.url) {
        throw new Error(body.error || "Could not start connecting Google Calendar.");
      }

      // Busy until the browser has left for Google.
      window.location.assign(body.url);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not start connecting Google Calendar."));
      setReconnectingGoogle(false);
    }
  }

  function seriesRepeat(seriesId: string): Promise<GoogleSeriesRepeat> {
    const requests = seriesRepeatRequests.current;
    let request = requests.get(seriesId);
    if (!request) {
      request = fetchGoogleSeriesRepeat(seriesId);
      requests.set(seriesId, request);
      request.then(
        (answer) => { seriesRepeatAnswers.current.set(seriesId, answer); },
        () => { requests.delete(seriesId); },
      );
    }
    return request;
  }

  /** After a Google save: a series' rule may have changed, and other months may show it. */
  function forgetGoogleSeries(scope: RecurrenceEditScope) {
    seriesRepeatRequests.current.clear();
    seriesRepeatAnswers.current.clear();
    if (scope !== "single") invalidateEventCache();
  }

  /** A failure from Google that only connecting again fixes also turns the sidebar's row to Reconnect. */
  function noteGoogleFailure(error: unknown) {
    if (error instanceof GoogleRouteError && error.reconnect) showGoogleReconnect();
  }

  /** After a change: the windows it touched are dropped, and the events on screen read again. */
  async function reloadAfterChange(...changed: ({ start_time?: string; end_time?: string; recurrence?: CalendarEvent["recurrence"] } | null | undefined)[]) {
    for (const event of changed) invalidateEventCache(event);
    await loadEvents({ force: true });
  }

  function askScope(request: Omit<ScopeRequest, "requestId">) {
    setScopeError("");
    setScopeChoice(request.options[0]);
    setScopeRequest({ ...request, requestId: crypto.randomUUID() });
  }

  /* Cancel: only the question closes, so the form under it keeps its changes. */
  function closeScopePicker() {
    setScopeRequest(null);
    setScopeBusy(false);
    setScopeError("");
  }

  /** The form opens on the day that was clicked; which days a change is for is asked at Save. */
  function handleEditFromDetail(event: CalendarEvent) {
    const day = seriesDayOf(event, selectedOccurrence, events);
    setSelectedEvent(null);
    setSelectedOccurrence(null);
    setEditingContext({ originalEvent: event, draftEvent: day?.shown ?? event, day });

    const seriesId = event.google?.seriesId ?? null;
    editingSeries.current = seriesId;
    if (!seriesId) {
      setSeriesRepeatState(null);
      return;
    }
    setSeriesRepeatState(seriesRepeatAnswers.current.get(seriesId) ?? "loading");
    seriesRepeat(seriesId).then(
      (answer) => { if (editingSeries.current === seriesId) setSeriesRepeatState(answer); },
      () => { if (editingSeries.current === seriesId) setSeriesRepeatState("failed"); },
    );
  }

  /** The day as the form showed it, with the series' repeat the form showed. */
  function shownDay(draftEvent: CalendarEvent): CalendarEvent {
    if (!draftEvent.google?.seriesId || !seriesRepeatState || typeof seriesRepeatState !== "object") return draftEvent;
    return {
      ...draftEvent,
      google: { ...draftEvent.google, repeat: seriesRepeatState.repeat, repeatLabel: seriesRepeatState.label },
    };
  }

  async function handleDeleteFromDetail(eventId: string) {
    const event = events.find((entry) => entry.id === eventId);
    const day = event ? seriesDayOf(event, selectedOccurrence, events) : null;
    if (day) {
      setSelectedEvent(null);
      setSelectedOccurrence(null);
      askScope({ action: "delete", day, options: scopeOptions(day.series, false), fromForm: false });
      return;
    }

    setErrorMessage("");
    try {
      await deleteCalendarEvent(eventId, event?.google_event_id);
    } catch (error) {
      noteGoogleFailure(error);
      throw error;
    }
    setSelectedEvent(null);
    setSelectedOccurrence(null);
    await reloadAfterChange(event);
  }

  async function handleCreateSave(eventData: Omit<CalendarEvent, "id" | "created_at">) {
    setErrorMessage("");
    let created: CalendarEvent;
    try {
      ({ event: created } = await createCalendarEvent(eventData));
    } catch (error) {
      noteGoogleFailure(error);
      throw error;
    }
    setCreatingEvent(null);
    // A new Google series arrives as its first day, without its rule; the form's says it repeats.
    await reloadAfterChange(created, eventData);
  }

  async function handleEditSave(eventData: Omit<CalendarEvent, "id" | "created_at">) {
    if (!editingContext) return;
    const { originalEvent, draftEvent, day } = editingContext;
    const shown = shownDay(draftEvent);

    /*
     * A day of a series: if anything changed, ask which days it is for, over
     * the form. Nothing changed, nothing to ask.
     */
    if (day) {
      const changes = eventChanges(eventData, shown);
      if (Object.keys(changes).length === 0) {
        handleCloseModals();
        return;
      }
      askScope({
        action: "save",
        day,
        options: scopeOptions(day.series, Boolean(changes.repeat)),
        save: { eventData, shown },
        fromForm: true,
      });
      return;
    }

    setErrorMessage("");
    try {
      if (originalEvent.id.startsWith("google_") && originalEvent.google_event_id) {
        const changes = buildGoogleEventPatch(eventData, shown);
        if (Object.keys(changes).length > 0) await updateGoogleEvent(originalEvent.google_event_id, changes, "single");
        forgetGoogleSeries(changes.repeat ? "all" : "single");
      } else if (eventData.sync_to_google) {
        // A CronCal event moved into Google with the form's Google switch.
        await moveCalendarEventToGoogle(originalEvent.id, eventData);
      } else {
        await updateCalendarEvent(originalEvent.id, eventData);
      }
    } catch (error) {
      noteGoogleFailure(error);
      throw error;
    }

    setEditingContext(null);
    await reloadAfterChange(originalEvent, eventData);
  }

  async function handleEditDelete(_eventId: string) {
    if (!editingContext) return;
    const { originalEvent, day } = editingContext;
    if (day) {
      askScope({ action: "delete", day, options: scopeOptions(day.series, false), fromForm: true });
      return;
    }

    setErrorMessage("");
    try {
      await deleteCalendarEvent(originalEvent.id, originalEvent.google_event_id);
    } catch (error) {
      noteGoogleFailure(error);
      throw error;
    }
    setEditingContext(null);
    await reloadAfterChange(originalEvent);
  }

  /** A save for the days chosen. Returns what the page should say afterwards, if anything. */
  async function saveForScope(request: ScopeRequest, scope: RecurrenceEditScope): Promise<string> {
    const { day: { series, occurrence }, save, requestId } = request;
    if (!save) return "";
    const { eventData, shown } = save;
    if (series.source === "google" && series.google_event_id) {
      // Only what was changed on the day goes to the days chosen.
      const changes = buildGoogleEventPatch(eventData, shown);
      const { notCarried } = await updateGoogleEvent(series.google_event_id, changes, googleScope(series, scope));
      forgetGoogleSeries(changes.repeat ? "all" : scope);
      return notCarried > 0 ? notCarriedWarning(notCarried) : "";
    }
    if (scope === "single") {
      await applyRecurringOccurrenceEdit(series, occurrence, eventData);
    } else if (scope === "following") {
      await applyRecurringFollowingEdit(series, occurrence, eventData, shown, requestId);
    } else {
      await applyRecurringSeriesEdit(series, occurrence, eventData, shown);
    }
    return "";
  }

  /* A dragged day of a series, for the days chosen: the series moves with it. */
  async function moveForScope(request: ScopeRequest, scope: RecurrenceEditScope): Promise<string> {
    const { day: { series, occurrence, shown }, moveTo, requestId } = request;
    if (!moveTo) return "";
    const moved = { start_time: moveTo.start.toISOString(), end_time: moveTo.end.toISOString() };
    if (series.source === "google" && series.google_event_id) {
      const { notCarried } = await updateGoogleEvent(series.google_event_id, buildGoogleEventPatch(moved, series), scope);
      forgetGoogleSeries(scope);
      return notCarried > 0 ? notCarriedWarning(notCarried) : "";
    }
    const movedFields = { ...eventFields(shown), ...moved };
    if (scope === "single") {
      await applyRecurringOccurrenceEdit(series, occurrence, movedFields);
    } else if (scope === "following") {
      await applyRecurringFollowingEdit(series, occurrence, movedFields, shown, requestId);
    } else {
      await applyRecurringSeriesEdit(series, occurrence, movedFields, shown);
    }
    return "";
  }

  async function deleteForScope(request: ScopeRequest, scope: RecurrenceEditScope): Promise<void> {
    const { day: { series, occurrence } } = request;
    if (series.source === "google") {
      await deleteCalendarEvent(series.id, series.google_event_id, googleScope(series, scope));
      forgetGoogleSeries(scope);
    } else if (scope === "single") {
      await deleteRecurringOccurrence(series, occurrence);
    } else if (scope === "following") {
      // From the series' first day, this is the whole series (supabase/schema.sql).
      await deleteRecurringFollowing(series, occurrence);
    } else {
      await deleteCalendarEvent(series.id, series.google_event_id);
    }
  }

  /*
   * Confirm. A failure stays in the question, with the form still under it,
   * so it can be tried again or cancelled back to the changes. Each choice is
   * written whole or not at all (lib/calendar-events), and the events on
   * screen are read again behind the question, in case the failure was only
   * the answer getting lost on its way back.
   */
  async function confirmScope() {
    if (!scopeRequest || scopeBusy) return;
    const request = scopeRequest;
    const scope = scopeChoice;
    setScopeBusy(true);
    setScopeError("");
    try {
      setErrorMessage("");
      const warning = request.action === "save"
        ? await saveForScope(request, scope)
        : request.action === "move"
          ? await moveForScope(request, scope)
          : (await deleteForScope(request, scope), "");

      if (request.fromForm) handleCloseModals();
      else closeScopePicker();
      await reloadAfterChange(request.day.series, request.save?.eventData);
      if (warning) setNotice({ tone: "info", message: warning });
    } catch (error) {
      noteGoogleFailure(error);
      const fallback = request.action === "delete"
        ? "Could not delete that event. Try again."
        : request.action === "move"
          ? "Could not move that event. Try again."
          : "Could not save these changes. Try again.";
      setScopeError(getErrorMessage(error, fallback));
      void reloadAfterChange(request.day.series);
    } finally {
      setScopeBusy(false);
    }
  }

  /*
   * An event dragged on the time grid. One-off and Google events move at
   * once, on screen first and then saved, and put back if the save fails.
   * A day of a series asks which days to move, as Edit does, and a Google
   * day is its own event (Google sends them expanded).
   */
  async function saveMovedEvent(event: CalendarEvent, start: Date, end: Date) {
    const moved = { start_time: start.toISOString(), end_time: end.toISOString() };
    if (event.id.startsWith("google_") && event.google_event_id) {
      await updateGoogleEvent(event.google_event_id, buildGoogleEventPatch(moved, event));
      return;
    }
    await updateCalendarEvent(event.id, moved);
  }

  async function handleEventMove(
    event: CalendarEvent,
    occurrence: CalendarOccurrenceSelection | undefined,
    start: Date,
    end: Date,
  ) {
    const day = seriesDayOf(event, occurrence, events);
    if (day) {
      askScope({ action: "move", day, moveTo: { start, end }, options: scopeOptions(day.series, false), fromForm: false });
      return;
    }

    const previous = events;
    setEvents((current) => current.map((entry) => (
      entry.id === event.id ? { ...entry, start_time: start.toISOString(), end_time: end.toISOString() } : entry
    )));
    try {
      setErrorMessage("");
      await saveMovedEvent(event, start, end);
      await reloadAfterChange(event, { ...event, start_time: start.toISOString(), end_time: end.toISOString() });
    } catch (error) {
      noteGoogleFailure(error);
      setEvents(previous);
      setErrorMessage(getErrorMessage(error, "Could not move that event."));
    }
  }

  function handleCloseModals() {
    setSelectedEvent(null);
    setSelectedOccurrence(null);
    setEditingContext(null);
    setCreatingEvent(null);
    closeScopePicker();
    setSeriesRepeatState(null);
    editingSeries.current = null;
    // Asked again next time: the series may be changed in Google meanwhile.
    seriesRepeatRequests.current.clear();
    seriesRepeatAnswers.current.clear();
  }

  // ─── Render ──────────────────────────────────────────────────────

  /* The seven days the week grid has on screen; see lib/calendar-range. */
  const weekWindow = resolveWeekWindow(currentDate, visibleStart);

  const sidebar = (
    <CalendarSidebar
      currentDate={currentDate}
      highlightWindow={view === "week" ? weekWindow : null}
      events={events}
      countEvents={screenHoldsCounts ? events : todayEvents}
      today={today}
      onDateChange={setCurrentDate}
      googleStatus={googleStatus}
      showGoogleEvents={showGoogleEvents}
      onToggleGoogleEvents={() => setShowGoogleEvents((current) => !current)}
      onReconnectGoogle={() => { void startGoogleConnection(); }}
      reconnectingGoogle={reconnectingGoogle}
      stacked={phone}
    />
  );

  const calendar = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        flexShrink: phone ? 0 : undefined,
        /* Over the foot room to the bottom of the screen on a desktop, where
           the grid owns the page. A phone's page scrolls on past it to the
           sidebar, which <main>'s own room already clears. */
        marginBottom: phone ? undefined : UNDER_DOCK_MARGIN,
      }}
    >
      <CalendarHeader
        view={view}
        currentDate={currentDate}
        onViewChange={setView}
        onDateChange={setCurrentDate}
        onToday={() => setCurrentDate(new Date())}
        onNewEvent={() => setCreatingEvent({})}
        weekWindow={weekWindow}
      />

      {notice && (
        <StatusBanner tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} style={{ marginBottom: 12 }} />
      )}
      {errorMessage && (
        <StatusBanner
          message={errorMessage}
          onDismiss={() => setErrorMessage("")}
          style={{ marginBottom: 12 }}
        />
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: CALENDAR_COLUMN_GAP }}>
        {/* Main content area */}
        <div style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--ui-radius-lg)",
          boxShadow: "var(--card-shadow)",
          overflow: "hidden",
        }}>
          {coldLoadingEvents ? (
            <LoadingState label="Loading calendar…" minHeight="60vh" />
          ) : firstLoadError ? (
            <div style={{ maxWidth: 420, width: "100%", margin: "64px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <StatusBanner message={firstLoadError} />
              <DialogButton
                variant="secondary"
                onClick={() => {
                  setFirstLoadError("");
                  void loadEvents({ force: true });
                }}
              >
                Try again
              </DialogButton>
            </div>
          ) : view === "month" ? (
            <MonthGrid
              currentDate={currentDate}
              events={events}
              selectedKey={selectedKey}
              onEventSelect={setSelectedKey}
              onEventOpen={handleEventOpen}
              onDateClick={handleDateClickFromMonth}
              onDateChange={setCurrentDate}
            />
          ) : (
            <TimeGrid
              view={view}
              currentDate={currentDate}
              events={events}
              selectedKey={selectedKey}
              onEventSelect={setSelectedKey}
              onEventOpen={handleEventOpen}
              onSlotSelect={handleSlotSelect}
              onEventMove={(event, occurrence, start, end) => { void handleEventMove(event, occurrence, start, end); }}
              onDateChange={setCurrentDate}
              onVisibleStartChange={setVisibleStart}
            />
          )}
        </div>

        {/* Right sidebar: mini calendar + event stats */}
        {!phone && sidebar}
      </div>

      {/* ── Modal: Event detail ──────────────────────────────────── */}
      {selectedEvent && !editingContext && (
        <EventDetailPanel
          event={selectedEvent}
          series={selectedEvent.recurrence_parent_id ? seriesDayOf(selectedEvent, selectedOccurrence, events)?.series : undefined}
          occurrence={selectedOccurrence ?? undefined}
          onClose={handleCloseModals}
          onEdit={handleEditFromDetail}
          onDelete={handleDeleteFromDetail}
        />
      )}

      {/* ── Modal: Editing existing event ────────────────────────── */}
      {editingContext && (
        <EventFormPanel
          existingEvent={editingContext.draftEvent}
          seriesRepeat={editingContext.draftEvent.google?.seriesId ? seriesRepeatState ?? "loading" : undefined}
          onSave={handleEditSave}
          onDelete={handleEditDelete}
          onCancel={handleCloseModals}
          googleConnected={googleConnected}
        />
      )}

      {/* ── Modal: Creating new event ────────────────────────────── */}
      {creatingEvent && (
        <EventFormPanel
          initialEvent={creatingEvent}
          onSave={handleCreateSave}
          onCancel={handleCloseModals}
          googleConnected={googleConnected}
        />
      )}

      {/* ── Which days: over the form, once there is something to apply ── */}
      {scopeRequest && (
        <ScopePicker
          action={scopeRequest.action}
          title={SCOPE_TITLES[scopeRequest.action]}
          options={scopeRequest.options}
          value={scopeChoice}
          onChange={setScopeChoice}
          onConfirm={() => { void confirmScope(); }}
          onCancel={closeScopePicker}
          busy={scopeBusy}
          error={scopeError}
          onDismissError={() => setScopeError("")}
        />
      )}
    </div>
  );

  /*
   * On a phone the sidebar cannot sit beside the grid: at 390px it would
   * leave the week 140px wide. It goes underneath instead, outside the full-height
   * block, so the grid still owns the first screen and the mini calendar,
   * the counts and the Google switch are one scroll away rather than gone.
   */
  if (phone) {
    return (
      <>
        {calendar}
        <div style={{ flexShrink: 0, marginTop: 12, marginBottom: 16 }}>{sidebar}</div>
      </>
    );
  }

  return calendar;
}
