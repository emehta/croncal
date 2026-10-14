"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  mergeGoogleEvents,
  type GoogleSeriesRepeat,
  type RecurrenceEditScope,
} from "@/lib/calendar-events";
import StatusBanner from "@/components/StatusBanner";
import LoadingState from "@/components/LoadingState";
import { resolveWeekWindow } from "@/lib/calendar-range";
import { fromDateStr } from "@/lib/date-utils";
import { useUrlTarget } from "@/lib/use-url-target";
import { getErrorMessage, isAbortError } from "@/lib/error-utils";
import { authedFetch } from "@/lib/authed-fetch";
import type { GoogleStatusPayload } from "@/app/api/auth/google/status/route";
import { rememberConnection, rememberedConnection } from "@/lib/connection-memory";
import { CALENDAR_COLUMN_GAP, UNDER_DOCK_MARGIN } from "@/lib/styles";
import { usePhone } from "@/lib/use-viewport-width";
import { eventChanges, scopeOptions } from "@/lib/series-edit";

// ─── Date range helpers ──────────────────────────────────────────────

/**
 * The window of events to hold in memory for a view.
 *
 * Widened to whole months on purpose. It used to be currentDate plus or minus
 * ten days, and the day grid reports the left-hand day as you scroll, so every
 * single day you dragged past produced a window nobody had fetched: a new
 * cache key, a miss, the events cleared and "Loading calendar" on screen, then
 * a jump when the answer arrived. Measured over sixty days of scrolling, sixty
 * of sixty were misses. The cache could not hit even once.
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
   * Every view takes the same window. Month view used to take only the month
   * on screen, which was right while it could jump a month at a time; it
   * scrolls continuously through them now, so the weeks either side of a
   * boundary would have come back empty.
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
 * It used to start at "disconnected", and the sidebar draws nothing for that
 * — so the Google row appeared only once the status round trip came back, well
 * after the rest of the page, shoving the layout as it arrived. The round trip
 * is slow for a reason: it refreshes the token and asks Google whether the
 * calendar scope is still granted, which is two calls out. So the row is drawn
 * from the first paint and fills in, rather than arriving late.
 */
type GoogleCalendarStatus = "checking" | "connected" | "disconnected" | "reconnect";

type CalendarEventCacheEntry = {
  events: CalendarEvent[];
  timestamp: number;
  view: CalendarView;
  startIso: string;
  endIso: string;
  googleEnabled: boolean;
  startMs: number;
  endMs: number;
};

type EventRangeDescriptor = {
  view: CalendarView;
  currentDate: Date;
  startIso: string;
  endIso: string;
  googleEnabled: boolean;
  cacheKey: string;
};

const EVENT_CACHE_STALE_MS = 60 * 1000;
const eventCache = new Map<string, CalendarEventCacheEntry>();
const prefetchInFlight = new Set<string>();

function getEventCacheKey(view: CalendarView, startIso: string, endIso: string, googleEnabled: boolean): string {
  return `${view}:${startIso}:${endIso}:google-${googleEnabled ? "on" : "off"}`;
}

function setEventCache(
  view: CalendarView,
  startIso: string,
  endIso: string,
  googleEnabled: boolean,
  events: CalendarEvent[],
) {
  eventCache.set(getEventCacheKey(view, startIso, endIso, googleEnabled), {
    events,
    timestamp: Date.now(),
    view,
    startIso,
    endIso,
    googleEnabled,
    startMs: new Date(startIso).getTime(),
    endMs: new Date(endIso).getTime(),
  });
}

function isFresh(entry: CalendarEventCacheEntry | undefined): entry is CalendarEventCacheEntry {
  return Boolean(entry && Date.now() - entry.timestamp < EVENT_CACHE_STALE_MS);
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
 * A month in every view, because that is the size of a window now. Stepping a
 * day or a week landed inside the same month and prefetched the range already
 * on screen, which warmed nothing and left the real neighbour cold.
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

function invalidateEventCacheForEventLike(
  event: { start_time?: string; end_time?: string; recurrence?: CalendarEvent["recurrence"] } | null | undefined,
) {
  if (!event?.start_time || !event.end_time || event.recurrence) {
    eventCache.clear();
    return;
  }

  const startMs = new Date(event.start_time).getTime();
  const endMs = new Date(event.end_time).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    eventCache.clear();
    return;
  }

  for (const [key, entry] of eventCache.entries()) {
    if (endMs >= entry.startMs && startMs <= entry.endMs) {
      eventCache.delete(key);
    }
  }
}

type CalendarOccurrenceSelection = {
  start: Date;
  end: Date;
};

/**
 * Whether an event is one day of a series: one of CronCal's own, or a day of a
 * Google series, which Google sends expanded, each with its own id. A Google
 * day used to be treated as a one-off, so a change to it changed that day
 * alone without asking, and a series could not be changed at all.
 */
function isRepeating(event: CalendarEvent): boolean {
  return Boolean(event.recurrence) || Boolean(event.google?.seriesId);
}

/**
 * The day of a series that was clicked, as the grid says. Opened another way
 * (a search link), a Google day is its own and a CronCal series' is its first.
 */
function occurrenceFor(
  event: CalendarEvent,
  selected: CalendarOccurrenceSelection | null | undefined,
): CalendarOccurrenceSelection | null {
  if (selected) return selected;
  return isRepeating(event) ? { start: new Date(event.start_time), end: new Date(event.end_time) } : null;
}

/** The scope a Google save is sent with: a one-off has only itself. */
function googleScope(event: CalendarEvent, scope: RecurrenceEditScope): RecurrenceEditScope {
  return event.google?.seriesId ? scope : "single";
}

/** What a save says when changed days could not follow their series. */
function notCarriedWarning(count: number): string {
  return count === 1
    ? "Saved. One day you had changed on its own is not in the series' new pattern, so its own changes could not be kept."
    : `Saved. ${count} days you had changed on their own are not in the series' new pattern, so their own changes could not be kept.`;
}

/**
 * A save, drag or deletion of a repeating event, waiting on which days it is
 * for. Asked after the fact, once there is a change to apply: the question
 * used to come before the form, when nothing had been changed yet.
 */
type ScopeRequest = {
  action: "save" | "delete" | "move";
  event: CalendarEvent;
  occurrence: CalendarOccurrenceSelection;
  options: RecurrenceEditScope[];
  /** For a save: what the form sent, and the day as the form showed it. */
  save?: { eventData: Omit<CalendarEvent, "id" | "created_at">; shown: CalendarEvent };
  /** For a move: where the dragged day was dropped. */
  moveTo?: CalendarOccurrenceSelection;
  /** Asked over the event form, which closes with it once it is answered. */
  fromForm: boolean;
};

const SCOPE_TITLES: Record<ScopeRequest["action"], string> = {
  save: "Edit recurring event",
  delete: "Delete recurring event",
  move: "Move recurring event",
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
  occurrence: CalendarOccurrenceSelection | null;
};

/** A day of a CronCal series as the form shows it: the series, at that day's times. */
function draftForDay(event: CalendarEvent, occurrence: CalendarOccurrenceSelection | null): CalendarEvent {
  if (!event.recurrence || !occurrence) return event;
  return { ...event, start_time: occurrence.start.toISOString(), end_time: occurrence.end.toISOString() };
}

/** A Google series' repeat, for the form: being read, read, or not readable. */
type SeriesRepeatState = GoogleSeriesRepeat | "loading" | "failed" | null;

// ─── Component ───────────────────────────────────────────────────────

function CalendarPageInner() {
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
   * false, the first load was local only, and Google's events arrived a
   * status check, a scroll wait and a second local query later.
   */
  const [googleConnected, setGoogleConnected] = useState(() => rememberedConnection("google"));
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus>("checking");
  const [showGoogleEvents, setShowGoogleEvents] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [coldLoadingEvents, setColdLoadingEvents] = useState(true);

  /* ─── deep links from universal search ─── */

  /*
   * The date moves first, and it has to.
   *
   * The calendar only holds a window around the day it is showing, so an
   * event three months out simply is not in `events` yet. `?date=` is
   * therefore read without waiting for anything — moving the view is what
   * causes the fetch that brings `?event=` into range — and the event link
   * below waits for that fetch to land before it looks for its id.
   */
  useUrlTarget("date", true, (value) => {
    const target = fromDateStr(value);
    if (Number.isNaN(target.getTime())) return;
    setView("day");
    setCurrentDate(target);
  });

  useUrlTarget("event", !coldLoadingEvents, (id) => {
    const target = events.find((event) => event.id === id);
    if (!target) return;
    setSelectedEvent(target);
    setSelectedOccurrence(null);
  });

  /* An empty form needs no data, so it opens straight away. */
  useUrlTarget("new", true, () => setCreatingEvent({}));
  /* Whether anything has ever been rendered, which decides blank vs stale. */
  const hasLoadedOnceRef = useRef(false);
  const eventAbortRef = useRef<AbortController | null>(null);
  const firstEventFetchRef = useRef(true);
  const googleEventsEnabled = googleConnected && showGoogleEvents;
  /*
   * The window is a function of the month, so the month is what it is built
   * from. Passing currentDate straight in made a new descriptor object for
   * every day, which made loadEvents a new function, which re-ran the fetch
   * effect on every single day scrolled past — aborting the request in flight
   * each time. The window it produced was identical every time.
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
          return "";
        case "denied":
          return "Google Calendar wasn't connected: permission was declined. Try again and allow calendar access.";
        case "scope_missing":
          return "Google Calendar wasn't connected: calendar access wasn't ticked. Try again and tick it.";
        case "expired":
          return "That connection attempt timed out. Start it again from Settings.";
        default:
          return "Google would not complete the connection. Try again in a moment.";
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
         * generic "could not verify" — the specific one is the useful one, and
         * a failed attempt usually makes the status check fail too.
         */
        if (!outcomeMessage) {
          setErrorMessage(getErrorMessage(error, "Could not verify Google Calendar connection."));
        }
      }
    }
    checkGoogle();
  }, []);

  // ─── Fetch events ────────────────────────────────────────────────

  const fetchEventsForRange = useCallback(async (
    range: EventRangeDescriptor,
    signal: AbortSignal,
    options: { surfaceGoogleErrors: boolean },
  ): Promise<CalendarEvent[]> => {
    /*
     * Both requests start together. They are independent, and asking Google
     * only once the local query had answered put one round trip after the
     * other on every load. The catch only keeps an early local failure from
     * leaving this promise unhandled; it is awaited, errors and all, below.
     */
    const googleRequest = range.googleEnabled
      ? fetchGoogleEvents(range.startIso, range.endIso, signal)
      : null;
    googleRequest?.catch(() => {});

    const localEvents = await fetchCalendarEvents(range.startIso, range.endIso, signal);
    setEventCache(range.view, range.startIso, range.endIso, false, localEvents);

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    if (!googleRequest) {
      return localEvents;
    }

    /*
     * Nothing is drawn until Google has answered too: the two arrive as one.
     * CronCal's own events used to be drawn as soon as they came back, so on
     * opening the calendar a CronCal event sat alone in an empty week and the
     * schedule appeared around it a moment later (the owner, 5 Oct 2026).
     * Both requests are already in flight, so this costs no time: the grid
     * fills when Google's events would have arrived anyway.
     */
    try {
      const googleEvents = await googleRequest;
      const merged = mergeGoogleEvents(localEvents, googleEvents);
      setEventCache(range.view, range.startIso, range.endIso, true, merged);
      return merged;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (options.surfaceGoogleErrors) {
        setErrorMessage(getErrorMessage(error, "Google Calendar couldn't be loaded. Reconnect it in Settings if this keeps happening."));
      }
      return localEvents;
    }
  }, []);

  const prefetchRange = useCallback((range: EventRangeDescriptor) => {
    const cached = eventCache.get(range.cacheKey);
    if (isFresh(cached) || prefetchInFlight.has(range.cacheKey)) return;

    prefetchInFlight.add(range.cacheKey);
    scheduleIdleTask(() => {
      if (isFresh(eventCache.get(range.cacheKey))) {
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
    const cached = eventCache.get(eventRange.cacheKey);
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
     * Otherwise the previous window stays up while the new one loads. Blanking
     * it meant a scroll that crossed a boundary emptied the grid and put a
     * loader over it for the length of a round trip, which reads as the
     * calendar breaking rather than fetching. The windows overlap anyway.
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
      prefetchAdjacentRanges(eventRange);
    } catch (error) {
      if (isAbortError(error)) return;
      setColdLoadingEvents(false);
      setErrorMessage(getErrorMessage(error, "Could not load your calendar events from Supabase."));
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
    try {
      setErrorMessage("");
      const response = await authedFetch("/api/auth/google?connect=true&format=json");
      const body = await response.json().catch(() => ({})) as { error?: string; url?: string };

      if (!response.ok || !body.url) {
        throw new Error(body.error || "Could not start Google Calendar connection.");
      }

      window.location.assign(body.url);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not start Google Calendar connection."));
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
    if (scope !== "single") eventCache.clear();
  }

  function askScope(request: ScopeRequest) {
    setScopeError("");
    setScopeChoice(request.options[0]);
    setScopeRequest(request);
  }

  /* Cancel: only the question closes, so the form under it keeps its changes. */
  function closeScopePicker() {
    setScopeRequest(null);
    setScopeBusy(false);
    setScopeError("");
  }

  /** The form opens on the day that was clicked; which days a change is for is asked at Save. */
  function handleEditFromDetail(event: CalendarEvent) {
    const occurrence = occurrenceFor(event, selectedOccurrence);
    setSelectedEvent(null);
    setSelectedOccurrence(null);
    setEditingContext({ originalEvent: event, draftEvent: draftForDay(event, occurrence), occurrence });

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
    const occurrence = event ? occurrenceFor(event, selectedOccurrence) : null;
    if (event && isRepeating(event) && occurrence) {
      setSelectedEvent(null);
      setSelectedOccurrence(null);
      askScope({ action: "delete", event, occurrence, options: scopeOptions(event, false), fromForm: false });
      return;
    }

    try {
      setErrorMessage("");
      await deleteCalendarEvent(eventId, event?.google_event_id);
      setSelectedEvent(null);
      setSelectedOccurrence(null);
      invalidateEventCacheForEventLike(event);
      await loadEvents({ force: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not delete that event."));
      throw error;
    }
  }

  async function handleCreateSave(eventData: Omit<CalendarEvent, "id" | "created_at">) {
    try {
      setErrorMessage("");
      const { event: created, warning } = await createCalendarEvent(eventData);
      setCreatingEvent(null);
      invalidateEventCacheForEventLike(created);
      // A new Google series arrives as its first day, without its rule; the form's says it repeats.
      invalidateEventCacheForEventLike(eventData);
      await loadEvents({ force: true });
      if (warning) setErrorMessage(warning);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not create that event."));
      throw error;
    }
  }

  async function handleEditSave(eventData: Omit<CalendarEvent, "id" | "created_at">) {
    if (!editingContext) return;
    const { originalEvent, draftEvent, occurrence } = editingContext;
    const shown = shownDay(draftEvent);

    /*
     * A day of a series: if anything changed, ask which days it is for, over
     * the form. Nothing changed, nothing to ask.
     */
    if (isRepeating(originalEvent) && occurrence) {
      const changes = eventChanges(eventData, shown);
      if (Object.keys(changes).length === 0) {
        handleCloseModals();
        return;
      }
      askScope({
        action: "save",
        event: originalEvent,
        occurrence,
        options: scopeOptions(originalEvent, Boolean(changes.repeat)),
        save: { eventData, shown },
        fromForm: true,
      });
      return;
    }

    try {
      setErrorMessage("");
      let warning = "";
      if (originalEvent.id.startsWith("google_") && originalEvent.google_event_id) {
        const changes = buildGoogleEventPatch(eventData, shown);
        if (Object.keys(changes).length > 0) await updateGoogleEvent(originalEvent.google_event_id, changes, "single");
        forgetGoogleSeries(changes.repeat ? "all" : "single");
      } else if (eventData.sync_to_google && !originalEvent.sync_to_google && !originalEvent.google_event_id) {
        // A CronCal event moved into Google with the form's Google switch.
        await moveCalendarEventToGoogle(originalEvent.id, eventData);
      } else {
        const result = await updateCalendarEvent(originalEvent.id, eventData, originalEvent);
        if (result.warning) warning = result.warning;
      }

      setEditingContext(null);
      invalidateEventCacheForEventLike(originalEvent);
      invalidateEventCacheForEventLike(eventData);
      await loadEvents({ force: true });
      if (warning) setErrorMessage(warning);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not update that event."));
      throw error;
    }
  }

  async function handleEditDelete(_eventId: string) {
    if (!editingContext) return;
    const { originalEvent, occurrence } = editingContext;
    if (isRepeating(originalEvent) && occurrence) {
      askScope({ action: "delete", event: originalEvent, occurrence, options: scopeOptions(originalEvent, false), fromForm: true });
      return;
    }

    try {
      setErrorMessage("");
      await deleteCalendarEvent(originalEvent.id, originalEvent.google_event_id);
      setEditingContext(null);
      invalidateEventCacheForEventLike(originalEvent);
      await loadEvents({ force: true });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not delete that event."));
      throw error;
    }
  }

  /** A save for the days chosen. Returns what the page should say afterwards, if anything. */
  async function saveForScope(request: ScopeRequest, scope: RecurrenceEditScope): Promise<string> {
    const { event, occurrence, save } = request;
    if (!save) return "";
    const { eventData, shown } = save;
    if (event.source === "google" && event.google_event_id) {
      // Only what was changed on the day goes to the days chosen.
      const changes = buildGoogleEventPatch(eventData, shown);
      const { notCarried } = await updateGoogleEvent(event.google_event_id, changes, googleScope(event, scope));
      forgetGoogleSeries(changes.repeat ? "all" : scope);
      return notCarried > 0 ? notCarriedWarning(notCarried) : "";
    }
    if (scope === "single") {
      await applyRecurringOccurrenceEdit(event, occurrence, eventData);
    } else if (scope === "following") {
      await applyRecurringFollowingEdit(event, occurrence, eventData);
    } else {
      const { warning } = await applyRecurringSeriesEdit(event, occurrence, eventData, shown);
      return warning ?? "";
    }
    return "";
  }

  /* A dragged day of a series, for the days chosen: the series moves with it. */
  async function moveForScope(request: ScopeRequest, scope: RecurrenceEditScope): Promise<string> {
    const { event, occurrence, moveTo } = request;
    if (!moveTo) return "";
    const moved = { start_time: moveTo.start.toISOString(), end_time: moveTo.end.toISOString() };
    if (event.source === "google" && event.google_event_id) {
      const { notCarried } = await updateGoogleEvent(event.google_event_id, buildGoogleEventPatch(moved, event), scope);
      forgetGoogleSeries(scope);
      return notCarried > 0 ? notCarriedWarning(notCarried) : "";
    }
    const movedFields = { ...eventFields(event), ...moved };
    if (scope === "single") {
      await applyRecurringOccurrenceEdit(event, occurrence, movedFields);
    } else if (scope === "following") {
      await applyRecurringFollowingEdit(event, occurrence, movedFields);
    } else {
      const { warning } = await applyRecurringSeriesEdit(event, occurrence, movedFields, draftForDay(event, occurrence));
      return warning ?? "";
    }
    return "";
  }

  async function deleteForScope(request: ScopeRequest, scope: RecurrenceEditScope): Promise<void> {
    const { event, occurrence } = request;
    if (event.source === "google") {
      await deleteCalendarEvent(event.id, event.google_event_id, googleScope(event, scope));
      forgetGoogleSeries(scope);
    } else if (scope === "single") {
      await deleteRecurringOccurrence(event, occurrence);
    } else if (scope === "following") {
      await deleteRecurringFollowing(event, occurrence);
    } else {
      await deleteCalendarEvent(event.id, event.google_event_id);
    }
  }

  /*
   * Confirm. A failure stays in the question, with the form still under it,
   * so it can be tried again or cancelled back to the changes.
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
      invalidateEventCacheForEventLike(request.event);
      if (request.save) invalidateEventCacheForEventLike(request.save.eventData);
      await loadEvents({ force: true });
      if (warning) setErrorMessage(warning);
    } catch (error) {
      const fallback = request.action === "delete"
        ? "Could not delete that event. Try again."
        : request.action === "move"
          ? "Could not move that event. Try again."
          : "Could not save these changes. Try again.";
      setScopeError(getErrorMessage(error, fallback));
    } finally {
      setScopeBusy(false);
    }
  }

  /*
   * An event dragged on the time grid. One-off and Google events move at
   * once, on screen first and then saved, and put back if the save fails.
   * A recurring event asks which occurrences to move, as Edit does, and a
   * Google occurrence is its own event (Google sends them expanded).
   */
  async function saveMovedEvent(event: CalendarEvent, start: Date, end: Date) {
    const moved = { start_time: start.toISOString(), end_time: end.toISOString() };
    if (event.id.startsWith("google_") && event.google_event_id) {
      await updateGoogleEvent(event.google_event_id, buildGoogleEventPatch(moved, event));
      return;
    }
    const { warning } = await updateCalendarEvent(event.id, moved, event);
    if (warning) setErrorMessage(warning);
  }

  async function handleEventMove(
    event: CalendarEvent,
    occurrence: CalendarOccurrenceSelection | undefined,
    start: Date,
    end: Date,
  ) {
    const day = occurrenceFor(event, occurrence);
    if (isRepeating(event) && day) {
      askScope({ action: "move", event, occurrence: day, moveTo: { start, end }, options: scopeOptions(event, false), fromForm: false });
      return;
    }

    const previous = events;
    setEvents((current) => current.map((entry) => (
      entry.id === event.id ? { ...entry, start_time: start.toISOString(), end_time: end.toISOString() } : entry
    )));
    try {
      setErrorMessage("");
      await saveMovedEvent(event, start, end);
      invalidateEventCacheForEventLike(event);
      invalidateEventCacheForEventLike({ ...event, start_time: start.toISOString(), end_time: end.toISOString() });
      await loadEvents({ force: true });
    } catch (error) {
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
      onDateChange={setCurrentDate}
      googleStatus={googleStatus}
      showGoogleEvents={showGoogleEvents}
      onToggleGoogleEvents={() => setShowGoogleEvents((current) => !current)}
      onReconnectGoogle={() => { void startGoogleConnection(); }}
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
        /* Under the dock to the foot of the screen on a desktop, where the
           grid owns the page. A phone's page scrolls on past it to the
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
          boxShadow: "var(--task-shadow)",
          overflow: "hidden",
        }}>
          {coldLoadingEvents ? (
            <LoadingState label="Loading calendar…" minHeight="60vh" />
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
   * On a phone the sidebar cannot sit beside the grid: at 390px it left the
   * week 140px wide. It goes underneath instead, outside the full-height
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

/** A boundary for `useUrlTarget`'s read of the query string — see /tools. */
export default function CalendarPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading calendar…" minHeight="60vh" />}>
      <CalendarPageInner />
    </Suspense>
  );
}
