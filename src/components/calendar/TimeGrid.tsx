"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarEvent } from "@/types/calendar-event";
import { expandRecurrences } from "@/lib/recurrence";
import { useTimeFormat, formatTime, formatHour } from "@/lib/time-format";
import { getWeekRange, useWeekStart } from "@/lib/week-start";
import { DAYS_SHORT, addDays, isToday, startOfDay, toDateStr } from "@/lib/date-utils";
import { Plus } from "@phosphor-icons/react";
import { DOCK_ROOM, eventFill, eventInk, priorityFill, priorityLine } from "@/lib/styles";
import { usePhone } from "@/lib/use-viewport-width";
import { tapSelection } from "@/lib/touch-gestures";
import { dragColumn, dragStartMinute, movedTimes } from "@/lib/event-drag";
import eventStyles from "./CalendarEvents.module.css";
import wash from "@/components/tasks/PriorityWash.module.css";
import { openTasksByDay } from "@/lib/task-order";
import { PRIORITY_COLORS, type CalendarTask, type Priority } from "@/types/task";
import {
  enumerateDays,
  getClippedOccurrenceForDay,
  layoutEvents,
  minutesFromDayStart,
  snapToSlot,
  type ColumnSlot,
} from "@/lib/calendar-layout";
import { contentColor, contentFill, contentInk } from "@/lib/content-palette";
import { doubleClickOpens, occurrenceKey as keyFor, pressKind, pressOutcome } from "@/lib/calendar-selection";

interface TimeGridProps {
  view: "day" | "week";
  currentDate: Date;
  events: CalendarEvent[];
  tasks?: CalendarTask[];
  /** The occurrence selected (lib/calendar-selection's key), drawn solid. */
  selectedKey: string | null;
  /** A press selected an occurrence, or a press away put the selection down (null). */
  onEventSelect: (key: string | null) => void;
  /** An event's card asked for: a double click, a second tap, or a key. */
  onEventOpen: (event: CalendarEvent, occurrence?: { start: Date; end: Date }) => void;
  onSlotSelect: (start: Date, end: Date) => void;
  /**
   * An event dragged to a new time or day. Given the event, the occurrence
   * that was dragged (for a recurring one) and where it was dropped.
   */
  onEventMove?: (
    event: CalendarEvent,
    occurrence: { start: Date; end: Date } | undefined,
    start: Date,
    end: Date,
  ) => void;
  onDateChange?: (date: Date) => void;
  /**
   * The first column on screen, whenever it changes: after a jump positions
   * the strip and as a scroll crosses a column. The header describes the
   * days actually visible from this, since a centred jump or a scroll leaves
   * them spanning two calendar weeks (see lib/calendar-range).
   */
  onVisibleStartChange?: (date: Date) => void;
}

/** Days either side of the anchor whenever the strip is built from scratch. */
const INITIAL_DAY_BUFFER = 21;

/*
 * Extension runs while a scroll is still in flight, and every extension
 * resizes the scroll content — which is an opportunity for the browser to
 * interrupt the gesture. A long lookahead in large steps means it happens
 * rarely, and never right at the edge where the strip would run out.
 */
const EDGE_EXTENSION_THRESHOLD_DAYS = 7;
const EDGE_EXTENSION_DAYS = 14;

/*
 * Left alone the strip only grows, so a session spent scrolling ends up
 * rendering hundreds of day columns and gets slower the longer it is used.
 * Past this it is rebuilt around wherever you are — but only while the scroll
 * is idle, because rebuilding under a moving gesture is what stops it dead.
 */
const MAX_STRIP_DAYS = 77;

/*
 * How the grid settles once you stop.
 *
 * Only the last SETTLE_THRESHOLD_RATIO of a column pulls; stop anywhere else
 * and the position is kept exactly as you left it, so most of a drag is free.
 * This replaces CSS scroll-snap, whose proximity threshold is not tunable:
 * Chrome was pulling from two fifths of a column away, about a second after
 * the gesture ended, in a single unanimated jump.
 */
const SETTLE_THRESHOLD_RATIO = 0.18;

/** How far the pointer must travel before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 5;

/*
 * The selection, while it is being dragged and once it has been let go.
 *
 * Both states share it so they cannot drift apart. The label is centred and
 * the box clips: it used to be pinned to the bottom edge with no clipping, so
 * on a short selection "New event" hung outside the dashed box entirely. The
 * border is one pixel, not two — at two it read as a heavy block rather than
 * a provisional marquee.
 */
const SELECTION_BOX: React.CSSProperties = {
  position: "absolute",
  left: 2,
  right: 2,
  zIndex: 5,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  overflow: "hidden",
  padding: 0,
  background: "var(--cal-selection-bg)",
  border: "1px dashed var(--cal-selection-border)",
  borderRadius: "var(--ui-radius-item)",
  color: "var(--cal-selection-text)",
  fontFamily: "inherit",
  fontSize: "var(--ui-type-label)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

/** Below this the box is shorter than its own text, so the text is dropped. */
const SELECTION_LABEL_MIN_HEIGHT = 24;
/** Below this only the plus fits beside the padding. */
const SELECTION_LABEL_MIN_WIDTH = 104;
const SETTLE_DURATION_MS = 190;
/** Quiet on the scroll event that counts as the gesture having stopped. */
const SCROLL_IDLE_MS = 150;

const HOUR_HEIGHT = 60;
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

/** A solid rule on every hour, drawn as a repeating background. */
const HOUR_LINE_BACKGROUND =
  `repeating-linear-gradient(to bottom, var(--c-grid-line) 0 1px, transparent 1px ${HOUR_HEIGHT}px)`;

/**
 * The half-hour rule. A gradient gives the line; a horizontally repeating
 * mask cuts it into dashes, which is what the old `1px dashed` border drew.
 */
const HALF_HOUR_DASH_MASK = "repeating-linear-gradient(to right, #000 0 3px, transparent 3px 6px)";
const halfHourRuleStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  opacity: 0.6,
  backgroundImage:
    `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_HEIGHT / 2}px, var(--c-grid-line) ${HOUR_HEIGHT / 2}px ${HOUR_HEIGHT / 2 + 1}px, transparent ${HOUR_HEIGHT / 2 + 1}px ${HOUR_HEIGHT}px)`,
  maskImage: HALF_HOUR_DASH_MASK,
  WebkitMaskImage: HALF_HOUR_DASH_MASK,
};
const GUTTER_WIDTH = 56;
/* "07:00" needs about 32px. The 12 this gives back are shared by the seven
   columns of a phone's week, which have none to spare. */
const GUTTER_WIDTH_PHONE = 44;
/*
 * Below this a column cannot hold "TUE 22" on one line or a task's title in
 * a pill, which is every column of a phone's week view (about 43px).
 */
const NARROW_COLUMN_WIDTH = 64;
const TASK_ROW_MIN_HEIGHT = 34;
/* The pills a day shows before the rest fold into "+N more". */
const MAX_VISIBLE_TASKS = 4;
const NO_TASKS: CalendarTask[] = [];

/* A task's colour, as on /tasks. A priority outside the four is drawn as Low. */
function taskHue(priority: Priority): string {
  return PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.low;
}

function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function currentTimeTop(date = new Date()): number {
  return (dateToMinutes(date) / 60) * HOUR_HEIGHT;
}

/**
 * Scrolls the grid so `top`, a point in the hours, sits in the middle of
 * the hours on screen: the scroller's height less the sticky header over
 * it, and less whatever of it runs under the dock at the foot of the
 * screen. Near either end of the day the browser holds it at the top or the
 * bottom, which is as close to the middle as it gets.
 */
function centreHoursOn(scroller: HTMLElement, grid: HTMLElement, header: HTMLElement, top: number): void {
  const headerHeight = header.getBoundingClientRect().height;
  const box = scroller.getBoundingClientRect();
  // Where the hours start inside the scrolled content.
  const gridTop = grid.getBoundingClientRect().top - box.top + scroller.scrollTop;
  const dockRoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-nav-clearance")) || 0;
  const underDock = Math.max(0, Math.min(box.height, box.bottom - (window.innerHeight - dockRoom)));
  const visibleHeight = Math.max(0, scroller.clientHeight - headerHeight - underDock);
  const target = Math.max(0, gridTop + top - headerHeight - visibleHeight / 2);
  if (Math.abs(scroller.scrollTop - target) >= 1) scroller.scrollTop = target;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getInitialStripRange(date: Date): { start: Date; end: Date } {
  const anchor = startOfDay(date);
  return {
    start: addDays(anchor, -INITIAL_DAY_BUFFER),
    end: addDays(anchor, INITIAL_DAY_BUFFER),
  };
}

interface EventOccurrence {
  event: CalendarEvent;
  occurrence?: { start: Date; end: Date };
  start: Date;
  end: Date;
  renderStart: Date;
  renderEnd: Date;
}

interface DayRenderData {
  timedEvents: EventOccurrence[];
  allDayEvents: EventOccurrence[];
  layout: Map<EventOccurrence, ColumnSlot>;
}

interface DragState {
  dayIndex: number;
  startMin: number;
  endMin: number;
}

/** An event being dragged: which one, and where it would land now. */
interface MoveState {
  key: string;
  occ: EventOccurrence;
  dayIndex: number;
  startMin: number;
  durationMin: number;
}

function occurrenceKey(occ: EventOccurrence): string {
  return keyFor(occ.event.id, occ.start);
}

export default function TimeGrid({
  view,
  currentDate,
  events,
  tasks,
  selectedKey,
  onEventSelect,
  onEventOpen,
  onSlotSelect,
  onEventMove,
  onDateChange,
  onVisibleStartChange,
}: TimeGridProps) {
  const weekStart = useWeekStart();
  const viewAnchor = useMemo(
    () => view === "week" ? getWeekRange(currentDate, weekStart).start : currentDate,
    [currentDate, view, weekStart],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  /** The one element that scrolls, in both axes. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerStackRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Last horizontal position acted on, to ignore purely vertical scrolls. */
  const lastScrollLeftRef = useRef(0);
  /** Whether the opening scroll still follows the header, before the reader has touched the grid. */
  const openingAimHeldRef = useRef(false);
  const currentTimeLabelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragListenersRef = useRef<(() => void) | null>(null);
  const horizontalScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const emittedDateKeyRef = useRef(toDateStr(viewAnchor));
  /** The last day this grid reported upwards, to recognise it coming back. */
  const selfEmittedDateKeyRef = useRef<string | null>(null);
  const pendingScrollDateKeyRef = useRef<string | null>(toDateStr(viewAnchor));
  /** Sub-column offset to preserve across a rebuild, so nothing appears to move. */
  const pendingScrollOffsetRef = useRef(0);
  /** Set once the strip has been positioned, so the runway check can start. */
  const hasPositionedRef = useRef(false);
  /**
   * Where the pending day should land: against the left edge, or in the
   * middle of the visible columns. Trimming has to hold the exact position it
   * started from; an external jump wants the day you asked for in view with
   * its neighbours either side of it.
   */
  const pendingScrollAlignRef = useRef<"start" | "center">("start");
  const pendingPrependDaysRef = useRef(0);
  const prependPendingRef = useRef(false);
  const appendPendingRef = useRef(false);
  const previousViewRef = useRef(view);
  const userScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleFrameRef = useRef<number | null>(null);
  const settlingRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const columnWidthRef = useRef(0);
  const daysRef = useRef<Date[]>([]);
  /** The first visible day last reported, so a scroll within a column says nothing. */
  const reportedVisibleKeyRef = useRef<string | null>(null);
  const onVisibleStartChangeRef = useRef(onVisibleStartChange);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [committedDrag, setCommittedDrag] = useState<DragState | null>(null);
  const [moving, setMoving] = useState<MoveState | null>(null);
  /* A drag ends in a click on the event it moved; that click is not an open. */
  const suppressEventClickRef = useRef(false);
  const [columnWidth, setColumnWidth] = useState(120);
  const [stripStart, setStripStart] = useState(() => getInitialStripRange(viewAnchor).start);
  const [stripEnd, setStripEnd] = useState(() => getInitialStripRange(viewAnchor).end);
  const fmt = useTimeFormat();
  const phone = usePhone();
  const gutterWidth = phone ? GUTTER_WIDTH_PHONE : GUTTER_WIDTH;
  /** What the last press on the grid was, since a tap arrives as a mousedown. */
  const pointerTypeRef = useRef<string>("mouse");
  /*
   * Whether the press in hand began away from every event while one was
   * selected. That press only puts the selection down: it must not also
   * start a new event under it, or clicking away to deselect would open the
   * new-event card.
   */
  const pressedAwayRef = useRef(false);

  const daysVisible = view === "week" ? 7 : 1;
  const days = useMemo(() => enumerateDays(stripStart, stripEnd), [stripStart, stripEnd]);
  /* Each day's open tasks, Critical first, so the four shown are the four that matter most. */
  const tasksByDay = useMemo(() => openTasksByDay(tasks ?? NO_TASKS), [tasks]);
  const daysKey = useMemo(() => days.map((day) => toDateStr(day)).join("|"), [days]);
  const stripWidth = days.length * columnWidth;
  const narrow = phone && columnWidth < NARROW_COLUMN_WIDTH;
  const numDays = days.length;
  const todayColIndex = days.findIndex((d) => isToday(d));
  const isTodayInView = todayColIndex >= 0;

  /*
   * The settle and trim callbacks are created once and run from timers, so
   * they read these rather than closing over a render's values.
   */
  useEffect(() => {
    columnWidthRef.current = columnWidth;
    daysRef.current = days;
    onVisibleStartChangeRef.current = onVisibleStartChange;
  });

  const reportVisibleStart = useCallback((day: Date) => {
    const key = toDateStr(day);
    if (key === reportedVisibleKeyRef.current) return;
    reportedVisibleKeyRef.current = key;
    onVisibleStartChangeRef.current?.(new Date(day));
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    const handleChange = () => { reducedMotionRef.current = query.matches; };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const releaseProgrammaticScroll = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
  }, []);

  const cancelSettle = useCallback(() => {
    if (settleFrameRef.current !== null) {
      cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    settlingRef.current = false;
  }, []);

  /*
   * Rebuild the strip around where you actually are, keeping the same day
   * under the same pixel so nothing moves. Only ever called from the settle,
   * which is to say only when the scroll has genuinely stopped.
   */
  const trimStripIfOversized = useCallback(() => {
    const el = scrollerRef.current;
    const width = columnWidthRef.current;
    const currentDays = daysRef.current;
    if (!el || width <= 0 || currentDays.length <= MAX_STRIP_DAYS) return;
    if (pendingScrollDateKeyRef.current || pendingPrependDaysRef.current > 0) return;

    const rawIndex = el.scrollLeft / width;
    const leftIndex = Math.max(0, Math.min(currentDays.length - 1, Math.round(rawIndex)));
    const leftDay = currentDays[leftIndex];
    if (!leftDay) return;

    const range = getInitialStripRange(leftDay);
    pendingScrollDateKeyRef.current = toDateStr(leftDay);
    pendingScrollOffsetRef.current = el.scrollLeft - leftIndex * width;
    pendingScrollAlignRef.current = "start";
    prependPendingRef.current = false;
    appendPendingRef.current = false;
    setStripStart(range.start);
    setStripEnd(range.end);
  }, []);

  /*
   * Pull to the nearest day edge, but only from close to one, and always as a
   * short animation rather than a jump.
   */
  const runSettle = useCallback(() => {
    const el = scrollerRef.current;
    const width = columnWidthRef.current;
    if (!el || width <= 0) return;

    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const nearest = Math.round(el.scrollLeft / width);
    const target = Math.max(0, Math.min(maxLeft, nearest * width));
    const distance = target - el.scrollLeft;

    // Already on an edge, or too far from one to be worth pulling.
    if (Math.abs(distance) < 0.5 || Math.abs(distance) > width * SETTLE_THRESHOLD_RATIO) {
      trimStripIfOversized();
      return;
    }

    if (reducedMotionRef.current) {
      programmaticScrollRef.current = true;
      el.scrollLeft = target;
      releaseProgrammaticScroll();
      trimStripIfOversized();
      return;
    }

    const from = el.scrollLeft;
    const startedAt = performance.now();
    settlingRef.current = true;

    const step = (now: number) => {
      const element = scrollerRef.current;
      if (!element) {
        settleFrameRef.current = null;
        settlingRef.current = false;
        return;
      }

      const t = Math.min(1, (now - startedAt) / SETTLE_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      element.scrollLeft = from + distance * eased;

      if (t < 1) {
        settleFrameRef.current = requestAnimationFrame(step);
        return;
      }

      settleFrameRef.current = null;
      settlingRef.current = false;
      trimStripIfOversized();
    };

    settleFrameRef.current = requestAnimationFrame(step);
  }, [releaseProgrammaticScroll, trimStripIfOversized]);

  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      runSettle();
    }, SCROLL_IDLE_MS);
  }, [runSettle]);

  /*
   * New input always wins: a settle in flight is abandoned, not fought, and
   * the opening scroll stops following the header, so the grid is where the
   * reader puts it from the first touch on.
   */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const handleInput = () => {
      cancelSettle();
      openingAimHeldRef.current = false;
    };
    const handleKey = () => { openingAimHeldRef.current = false; };
    el.addEventListener("wheel", handleInput, { passive: true });
    el.addEventListener("pointerdown", handleInput);
    el.addEventListener("touchstart", handleInput, { passive: true });
    el.addEventListener("keydown", handleKey);

    return () => {
      el.removeEventListener("wheel", handleInput);
      el.removeEventListener("pointerdown", handleInput);
      el.removeEventListener("touchstart", handleInput);
      el.removeEventListener("keydown", handleKey);
    };
  }, [cancelSettle]);

  /* cancelSettle is stable, so this only ever runs on unmount. */
  useEffect(() => cancelSettle, [cancelSettle]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const updateColumnWidth = () => {
      const availableWidth = Math.max(1, el.clientWidth - gutterWidth);
      const nextWidth = availableWidth / daysVisible;
      const previousWidth = columnWidthRef.current;

      /*
       * Hold the same day against the left edge across a resize.
       *
       * scrollLeft is a pixel offset, so widening the window silently slid the
       * strip under it: the columns showed one week while the heading named
       * another, and nothing corrected it until the next scroll. Recording the
       * day now lets the repositioning effect below put it back once the new
       * width has been committed.
       */
      if (previousWidth > 0 && nextWidth !== previousWidth) {
        const leftDay = daysRef.current[Math.round(el.scrollLeft / previousWidth)];
        if (leftDay) {
          pendingScrollDateKeyRef.current = toDateStr(leftDay);
          pendingScrollOffsetRef.current = 0;
          pendingScrollAlignRef.current = "start";
        }
      }

      setColumnWidth(nextWidth);
    };

    updateColumnWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateColumnWidth);
      return () => window.removeEventListener("resize", updateColumnWidth);
    }

    const observer = new ResizeObserver(updateColumnWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [daysVisible, gutterWidth]);

  useLayoutEffect(() => {
    const viewChanged = previousViewRef.current !== view;
    previousViewRef.current = view;

    /*
     * The day this grid just reported, arriving back as a prop. The scroll
     * position that produced it is by definition already correct.
     *
     * The old guard stored the week *anchor* a scrolled day would produce and
     * compared that, so it only matched when the effect happened to see the
     * same render the scroll had queued. Two scroll updates in one frame left
     * it holding a key the effect never saw, it read that as an external jump,
     * rebuilt the strip and threw scrollLeft at the first day of the week.
     * That was the random snap to the next week. Comparing the day against
     * the day cannot drift like that.
     */
    if (!viewChanged && selfEmittedDateKeyRef.current === toDateStr(currentDate)) return;

    // Never reposition under a gesture that is still moving.
    if (!viewChanged && userScrollingRef.current) return;

    // Everything left is an external jump: Today, the arrows, the mini calendar.
    selfEmittedDateKeyRef.current = null;
    cancelSettle();

    const frame = requestAnimationFrame(() => {
      const nextRange = getInitialStripRange(viewAnchor);
      setStripStart(nextRange.start);
      setStripEnd(nextRange.end);
      /*
       * The date itself, centred — not the week it belongs to, pinned left.
       * Pressing Today put today wherever it happened to fall in its week, so
       * a Tuesday landed third from the left with nothing before it; the day
       * you asked for should have its neighbours on both sides.
       */
      pendingScrollDateKeyRef.current = toDateStr(currentDate);
      pendingScrollOffsetRef.current = 0;
      pendingScrollAlignRef.current = "center";
      pendingPrependDaysRef.current = 0;
      prependPendingRef.current = false;
      appendPendingRef.current = false;
      setCommittedDrag(null);
      setDrag(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [cancelSettle, currentDate, view, viewAnchor]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    if (pendingPrependDaysRef.current > 0) {
      const addedDays = pendingPrependDaysRef.current;
      pendingPrependDaysRef.current = 0;
      programmaticScrollRef.current = true;
      el.scrollLeft += addedDays * columnWidth;
      prependPendingRef.current = false;
      releaseProgrammaticScroll();
      return;
    }

    const key = pendingScrollDateKeyRef.current;
    if (!key) return;

    /*
     * Wait until the width in state is the width on screen.
     *
     * columnWidth starts at a guess and is measured on the first layout pass,
     * so this effect's first run had the guess. It positioned by it, cleared
     * the pending key, and every correction afterwards compounded from the
     * wrong place — a centred day came out three columns off. The key is left
     * in place, and this runs again when the measurement lands.
     */
    const measured = Math.max(1, (el.clientWidth - gutterWidth) / daysVisible);
    if (Math.abs(measured - columnWidth) > 0.5) return;

    const index = days.findIndex((day) => toDateStr(day) === key);
    if (index < 0) return;

    /*
     * Centring means putting the day in the middle column, so the left edge
     * starts half a viewport earlier. Clamped, because the day you asked for
     * can be near either end of the strip.
     */
    const leadingColumns = pendingScrollAlignRef.current === "center"
      ? Math.floor((daysVisible - 1) / 2)
      : 0;
    const maxLeftIndex = Math.max(0, days.length - daysVisible);
    const targetIndex = Math.max(0, Math.min(maxLeftIndex, index - leadingColumns));

    programmaticScrollRef.current = true;
    /*
     * The offset carries the fraction of a column you had scrolled to, so a
     * rebuild triggered by trimming puts the same pixel back under the same
     * day. It is zero for an external jump, which lands on a column edge.
     */
    el.scrollLeft = targetIndex * columnWidth + pendingScrollOffsetRef.current;
    pendingScrollDateKeyRef.current = null;
    pendingScrollOffsetRef.current = 0;
    pendingScrollAlignRef.current = "start";
    /*
     * The day now against the left edge, which after centring is not the day
     * that was asked for. Recording the wrong one made the first flick of the
     * scroll wheel re-report a date that had not changed.
     */
    emittedDateKeyRef.current = toDateStr(days[targetIndex] ?? days[index]);
    reportVisibleStart(days[targetIndex] ?? days[index]);
    hasPositionedRef.current = true;
    releaseProgrammaticScroll();
  }, [columnWidth, days, daysKey, daysVisible, gutterWidth, releaseProgrammaticScroll, reportVisibleStart]);

  useEffect(() => {
    appendPendingRef.current = false;
  }, [stripEnd]);

  /*
   * Keep runway at both ends, without waiting for a scroll event to ask.
   *
   * Extending only from the scroll handler is one missed event away from a
   * dead end: land exactly on the last column and there is nothing left to
   * scroll, so no further event fires and the strip cannot grow. The month
   * view was reachably stuck that way; this is the same mechanism sideways.
   */
  useEffect(() => {
    const el = scrollerRef.current;
    const width = columnWidthRef.current;
    if (!el || width <= 0 || days.length === 0 || !hasPositionedRef.current) return;
    if (pendingScrollDateKeyRef.current || pendingPrependDaysRef.current > 0) return;

    const frame = requestAnimationFrame(() => {
      const element = scrollerRef.current;
      if (!element) return;

      const leftIndex = Math.round(element.scrollLeft / width);
      if (leftIndex <= EDGE_EXTENSION_THRESHOLD_DAYS && !prependPendingRef.current) {
        prependPendingRef.current = true;
        pendingPrependDaysRef.current += EDGE_EXTENSION_DAYS;
        setStripStart((prev) => addDays(prev, -EDGE_EXTENSION_DAYS));
        return;
      }

      const daysAfter = days.length - (leftIndex + daysVisible);
      if (daysAfter <= EDGE_EXTENSION_THRESHOLD_DAYS && !appendPendingRef.current) {
        appendPendingRef.current = true;
        setStripEnd((prev) => addDays(prev, EDGE_EXTENSION_DAYS));
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [days, daysKey, daysVisible]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current !== null) clearTimeout(scrollIdleTimerRef.current);
  }, []);


  useEffect(() => {
    function updateCurrentTimeMarker() {
      const now = new Date();
      rootRef.current?.style.setProperty("--current-time-offset", `${currentTimeTop(now)}px`);
      if (currentTimeLabelRef.current) {
        currentTimeLabelRef.current.textContent = formatTime(now, fmt);
      }
    }

    updateCurrentTimeMarker();
    const interval = setInterval(updateCurrentTimeMarker, 60000);
    return () => clearInterval(interval);
  }, [fmt]);

  useEffect(() => {
    return () => {
      if (horizontalScrollFrameRef.current !== null) {
        cancelAnimationFrame(horizontalScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      dragListenersRef.current?.();
    };
  }, []);

  /*
   * Derived from the strip, not from currentDate. currentDate was only ever a
   * fallback for an empty strip, but naming it as a dependency meant both of
   * these — and therefore dayRenderData, which expands every recurrence and
   * lays out every column — were rebuilt on each day scrolled past.
   */
  const rangeStart = useMemo(() => startOfDay(stripStart), [stripStart]);
  const rangeEnd = useMemo(() => {
    const end = startOfDay(stripEnd);
    end.setHours(23, 59, 59, 999);
    return end;
  }, [stripEnd]);

  /*
   * Every event placed on the days it touches, in one pass.
   *
   * This used to walk the whole event list once per day: for each of up to 77
   * days it re-parsed every event's start and end, and for each recurring one
   * it walked that event's occurrences across the entire strip only to keep
   * the one day it was looking at. With a few hundred Google instances on
   * screen that is tens of thousands of Date parses per render, all of it
   * thrown away. Parsing once and bucketing by day gives the same maps.
   */
  const dayRenderData = useMemo(() => {
    const data = new Map<string, DayRenderData>();

    if (view !== "day" && view !== "week") {
      return data;
    }

    const timedByDay = new Map<string, EventOccurrence[]>();
    const allDayByDay = new Map<string, EventOccurrence[]>();
    for (const day of days) {
      const key = toDateStr(day);
      timedByDay.set(key, []);
      allDayByDay.set(key, []);
    }

    const stripStartMs = startOfDay(rangeStart).getTime();
    const stripEndMs = rangeEnd.getTime();

    function place(event: CalendarEvent, start: Date, end: Date, occurrence?: { start: Date; end: Date }) {
      if (end.getTime() <= stripStartMs || start.getTime() > stripEndMs) return;

      const bucket = event.all_day ? allDayByDay : timedByDay;
      // Walk only the days this occurrence actually covers.
      const cursor = startOfDay(start.getTime() < stripStartMs ? new Date(stripStartMs) : start);
      while (cursor.getTime() <= end.getTime() && cursor.getTime() <= stripEndMs) {
        const target = bucket.get(toDateStr(cursor));
        if (target) {
          const clipped = getClippedOccurrenceForDay(start, end, cursor);
          if (clipped) {
            target.push({
              event,
              occurrence,
              start,
              end,
              renderStart: event.all_day ? start : clipped.renderStart,
              renderEnd: event.all_day ? end : clipped.renderEnd,
            });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    for (const event of events) {
      if (event.recurrence) {
        // Expanded once for the whole strip, not once per day.
        for (const occ of expandRecurrences(event, rangeStart, rangeEnd)) {
          place(event, occ.start, occ.end, occ);
        }
        continue;
      }
      place(event, new Date(event.start_time), new Date(event.end_time));
    }

    for (const day of days) {
      const key = toDateStr(day);
      const timedEvents = timedByDay.get(key) ?? [];
      data.set(key, {
        timedEvents,
        allDayEvents: allDayByDay.get(key) ?? [],
        layout: layoutEvents(timedEvents),
      });
    }

    return data;
  }, [days, events, rangeEnd, rangeStart, view]);

  /*
   * Where the grid opens vertically: the time now, in the middle of the
   * hours on screen, once for each view.
   *
   * It opened on the earliest event anywhere on the strip, after a 05:00 to
   * 11:00 schedule opened on an empty evening (20 Sep 2026). The schedule
   * fills every day from midnight now, so the earliest event was always at
   * 00:00 and the grid always opened at the top. The owner asked for now
   * (5 Oct 2026).
   *
   * The header over the hours can grow after the first paint (the day's
   * tasks arrive, an all-day row appears), which would push the line below
   * the middle. So the aim is held: taken again whenever the header or the
   * scroller changes height, until the first wheel, touch, press or key on
   * the grid. From then on the position is the reader's.
   */
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const grid = gridRef.current;
    const header = headerStackRef.current;
    if (!scroller || !grid || !header) return;

    openingAimHeldRef.current = true;
    const aim = () => {
      if (openingAimHeldRef.current) centreHoursOn(scroller, grid, header, currentTimeTop());
    };
    aim();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(aim);
    observer.observe(header);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [view]);

  const hasAllDayEvents = useMemo(() => {
    for (const value of dayRenderData.values()) {
      if (value.allDayEvents.length > 0) return true;
    }
    return false;
  }, [dayRenderData]);

  function handleGridScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    /*
     * This element owns both axes now, so it fires on vertical scrolling as
     * well. Only a change in the horizontal position should move the date,
     * extend the strip or arm a settle.
     */
    if (scroller.scrollLeft === lastScrollLeftRef.current) return;
    lastScrollLeftRef.current = scroller.scrollLeft;

    // Our own repositioning, which must not be read back as a gesture.
    if (programmaticScrollRef.current) return;

    if (!settlingRef.current) {
      /*
       * Held for a moment after the last scroll event. Any repositioning that
       * arrives while this is set is deferred, because assigning scrollLeft
       * under a momentum scroll is what the glitching was: the browser is
       * mid-animation and the assignment yanks it somewhere else.
       */
      userScrollingRef.current = true;
      if (scrollIdleTimerRef.current !== null) clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = setTimeout(() => {
        scrollIdleTimerRef.current = null;
        userScrollingRef.current = false;
      }, SCROLL_IDLE_MS);

      scheduleSettle();
    }

    if (horizontalScrollFrameRef.current !== null) return;

    horizontalScrollFrameRef.current = requestAnimationFrame(() => {
      horizontalScrollFrameRef.current = null;

      const el = scrollerRef.current;
      if (!el || columnWidth <= 0) return;

      /*
       * Rounded, not ceiled from two pixels in. Ceiling flipped the reported
       * day three pixels into a drag, so the smallest nudge re-rendered the
       * page and re-keyed the event window; rounding flips at the halfway
       * mark, which is also the day you are actually looking at.
       */
      const rawIndex = Math.round(el.scrollLeft / columnWidth);
      const maxLeftIndex = Math.max(0, days.length - daysVisible);
      const leftIndex = Math.max(0, Math.min(maxLeftIndex, rawIndex));
      const leftDay = days[leftIndex];
      if (leftDay) reportVisibleStart(leftDay);

      if (leftDay && onDateChange) {
        const key = toDateStr(leftDay);
        if (key !== emittedDateKeyRef.current) {
          emittedDateKeyRef.current = key;
          // Remembered so the same day, coming back as a prop, is recognised.
          selfEmittedDateKeyRef.current = key;
          onDateChange(new Date(leftDay));
        }
      }

      if (leftIndex <= EDGE_EXTENSION_THRESHOLD_DAYS && !prependPendingRef.current) {
        prependPendingRef.current = true;
        pendingPrependDaysRef.current += EDGE_EXTENSION_DAYS;
        setStripStart((prev) => addDays(prev, -EDGE_EXTENSION_DAYS));
      }

      const daysAfterViewport = days.length - (leftIndex + daysVisible);
      if (daysAfterViewport <= EDGE_EXTENSION_THRESHOLD_DAYS && !appendPendingRef.current) {
        appendPendingRef.current = true;
        setStripEnd((prev) => addDays(prev, EDGE_EXTENSION_DAYS));
      }
    });
  }

  /*
   * A tap on the grid, from a finger.
   *
   * On click, not on the mousedown a mouse uses: iOS Safari only sends the
   * mouse events that follow a tap to an element it considers clickable,
   * and React marks an element that way for onClick alone. A scroll never
   * produces a click, so a swipe through the day cannot select anything.
   *
   * A tap with a selection already showing puts it away rather than moving
   * it: the Create button covers the selection itself, so tapping elsewhere
   * is the only way to say "not that one".
   */
  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (pointerTypeRef.current !== "touch") return;
    if (pressedAwayRef.current) return;
    if ((e.target as Element).closest("button")) return;
    if (committedDrag) {
      setCommittedDrag(null);
      return;
    }
    const gridRect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - gridRect.left - gutterWidth;
    if (relX < 0) return;
    const selection = tapSelection(((e.clientY - gridRect.top) / HOUR_HEIGHT) * 60);
    if (!selection) return;
    const dayIndex = Math.max(0, Math.min(numDays - 1, Math.floor(relX / columnWidth)));
    setCommittedDrag({ dayIndex, ...selection });
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // A finger is handled on click instead; see handleGridClick.
    if (pointerTypeRef.current === "touch") return;
    if (pressedAwayRef.current) return;

    /*
     * Measured against the grid's own box, so it does not care where the grid
     * sits inside the scrolled content. This was the scroller's box plus its
     * scrollTop minus a leading offset, written out twice and already drifted:
     * the create-drag left the offset out, so a dragged selection ended
     * twelve minutes off where it started.
     */
    const gridEl = e.currentTarget as HTMLElement;
    const gridRect = gridEl.getBoundingClientRect();
    const clickMin = ((e.clientY - gridRect.top) / HOUR_HEIGHT) * 60;
    const relX = e.clientX - gridRect.left - gutterWidth;

    if (relX < 0) return;

    e.preventDefault();

    const dayIdx = Math.max(0, Math.min(numDays - 1, Math.floor(relX / columnWidth)));

    if (
      committedDrag &&
      committedDrag.dayIndex === dayIdx &&
      clickMin >= committedDrag.startMin &&
      clickMin <= committedDrag.endMin
    ) {
      const offsetMin = clickMin - committedDrag.startMin;
      const duration = committedDrag.endMin - committedDrag.startMin;
      let lastDay = committedDrag.dayIndex;
      let lastStart = committedDrag.startMin;

      const handleMoveMove = (ev: MouseEvent) => {
        // Re-measured each move, so scrolling mid-drag cannot skew it.
        const rect = gridEl.getBoundingClientRect();
        const rawMin = ((ev.clientY - rect.top) / HOUR_HEIGHT) * 60;
        const newStartMin = snapToSlot(
          Math.max(0, Math.min(23 * 60 + 59 - duration, rawMin - offsetMin)),
        );
        const newDayIdx = Math.max(
          0,
          Math.min(numDays - 1, Math.floor((ev.clientX - rect.left - gutterWidth) / columnWidth)),
        );
        // Only when it lands on another quarter hour or day: each update draws every event in the grid again.
        if (newDayIdx === lastDay && newStartMin === lastStart) return;
        lastDay = newDayIdx;
        lastStart = newStartMin;
        setCommittedDrag({ dayIndex: newDayIdx, startMin: newStartMin, endMin: newStartMin + duration });
      };

      const detachMove = () => {
        document.removeEventListener("mousemove", handleMoveMove);
        document.removeEventListener("mouseup", handleMoveUp);
        dragListenersRef.current = null;
      };

      const handleMoveUp = () => {
        detachMove();
      };

      document.addEventListener("mousemove", handleMoveMove);
      document.addEventListener("mouseup", handleMoveUp);
      dragListenersRef.current = detachMove;
      return;
    }

    /*
     * A press is not yet a selection.
     *
     * This used to set an hour-long drag on mousedown, so a single click on
     * empty space left an hour blocked out and a Create event button sitting
     * on it. Nothing starts until the pointer has actually travelled
     * DRAG_THRESHOLD_PX, which is what separates a click from a drag; a plain
     * click now only clears whatever was selected before.
     */
    setCommittedDrag(null);
    dragStateRef.current = null;
    const startMin = snapToSlot(Math.max(0, Math.min(23 * 60 + 45, clickMin)));
    const pressedAtY = e.clientY;
    let dragging = false;

    const handleCreateMove = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - pressedAtY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
      }

      const rect = gridEl.getBoundingClientRect();
      const endMin = snapToSlot(
        Math.max(0, Math.min(23 * 60 + 59, ((ev.clientY - rect.top) / HOUR_HEIGHT) * 60)),
      );
      const currStart = dragStateRef.current?.startMin ?? startMin;
      const updated: DragState = { dayIndex: dayIdx, startMin: currStart, endMin: Math.max(currStart + 15, endMin) };
      const previous = dragStateRef.current;
      // As the move handler below: no update unless the snapped selection changed.
      if (previous && previous.startMin === updated.startMin && previous.endMin === updated.endMin) return;
      dragStateRef.current = updated;
      setDrag(updated);
    };

    const detachCreate = () => {
      document.removeEventListener("mousemove", handleCreateMove);
      document.removeEventListener("mouseup", handleCreateUp);
      dragListenersRef.current = null;
    };

    const handleCreateUp = () => {
      detachCreate();
      const finalDrag = dragStateRef.current;
      dragStateRef.current = null;
      setDrag(null);
      if (finalDrag && finalDrag.endMin - finalDrag.startMin >= 15) {
        setCommittedDrag(finalDrag);
      }
    };

    document.addEventListener("mousemove", handleCreateMove);
    document.addEventListener("mouseup", handleCreateUp);
    dragListenersRef.current = detachCreate;
  }

  /*
   * Pressing an event and dragging it moves it.
   *
   * The press stops here, so the grid underneath no longer reads it as the
   * start of a new-event selection, which is what used to happen: dragging
   * an event drew a "New event" box instead. Nothing moves until the pointer
   * has travelled DRAG_THRESHOLD_PX, so a click still opens the event. Up and
   * down follow the pointer in quarter hours; another day only once the
   * pointer is clearly into its column (lib/event-drag), so the drift of a
   * hand moving straight down never hops it a day. Escape puts it back.
   *
   * Mouse only: a finger on the grid scrolls it. An event that runs past
   * midnight has no single column to drag in, so it is only selected and
   * opened.
   */
  function handleEventMouseDown(e: React.MouseEvent<HTMLButtonElement>, occ: EventOccurrence, dayIdx: number, day: Date) {
    if (e.button !== 0 || pointerTypeRef.current === "touch") return;
    e.stopPropagation();
    if (!onEventMove) return;
    const oneDay = occ.renderStart.getTime() === occ.start.getTime() && occ.renderEnd.getTime() === occ.end.getTime();
    const gridEl = gridRef.current;
    if (!oneDay || !gridEl) return;
    e.preventDefault();

    const pressRect = gridEl.getBoundingClientRect();
    const pressX = e.clientX;
    const pressY = e.clientY;
    const pressMin = ((e.clientY - pressRect.top) / HOUR_HEIGHT) * 60;
    const originStartMin = minutesFromDayStart(occ.start, day);
    const durationMin = (occ.end.getTime() - occ.start.getTime()) / 60000;
    const key = occurrenceKey(occ);
    const width = columnWidth;
    const columns = numDays;
    const gutter = gutterWidth;
    const stripDays = days;
    let column = dayIdx;
    let current: MoveState | null = null;
    const previousCursor = document.body.style.cursor;

    const handleMove = (ev: MouseEvent) => {
      if (!current && Math.hypot(ev.clientX - pressX, ev.clientY - pressY) < DRAG_THRESHOLD_PX) return;
      if (!current) document.body.style.cursor = "grabbing";
      // Re-measured each move, so a scroll mid-drag cannot skew it.
      const rect = gridEl.getBoundingClientRect();
      column = dragColumn(column, (ev.clientX - rect.left - gutter) / width, columns);
      const startMin = dragStartMinute(originStartMin, pressMin, ((ev.clientY - rect.top) / HOUR_HEIGHT) * 60, durationMin);
      if (current && current.dayIndex === column && current.startMin === startMin) return;
      current = { key, occ, dayIndex: column, startMin, durationMin };
      setMoving(current);
    };

    const detach = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.cursor = previousCursor;
      dragListenersRef.current = null;
    };

    function handleKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape" || !current) return;
      ev.preventDefault();
      ev.stopPropagation();
      current = null;
      setMoving(null);
      detach();
    }

    function handleUp() {
      detach();
      const landed = current;
      if (!landed) return;
      suppressEventClickRef.current = true;
      setTimeout(() => { suppressEventClickRef.current = false; }, 0);
      setMoving(null);
      if (landed.dayIndex === dayIdx && landed.startMin === originStartMin) return;
      const target = stripDays[landed.dayIndex];
      if (!target) return;
      const { start, end } = movedTimes(target, landed.startMin, occ.start, occ.end);
      onEventMove?.(occ.event, occ.occurrence, start, end);
    }

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.addEventListener("keydown", handleKey, true);
    dragListenersRef.current = detach;
  }

  /*
   * Saturday and Sunday are tinted down the whole column — header, tasks,
   * all-day and the grid — so the weekend reads as one band rather than a
   * shaded grid under an unshaded heading. Weekdays stay untouched in the
   * three header rows, which is how they already were.
   */
  const weekendCellBackground = (day: Date) =>
    isWeekend(day) ? "var(--cal-weekend-bg)" : "transparent";

  /* The ring round the now line: the grid's own colour, today's shade and all. */
  const nowBorder = (width: number) => {
    const ring = `0 0 0 ${width}px`;
    const today = days[todayColIndex];
    return today && isWeekend(today)
      ? `${ring} var(--cal-weekend-bg), ${ring} var(--c-surface)`
      : `${ring} var(--c-surface)`;
  };

  const stickyGutterStyle: React.CSSProperties = {
    width: gutterWidth,
    flexShrink: 0,
    position: "sticky",
    left: 0,
    zIndex: 12,
    /*
     * --c-surface-solid is not declared in any theme, so this read
     * --page-bg, and the gutter sat a shade darker than the card it is
     * inside (#1c1c1c against #272727 on Midnight, and a mismatch in the
     * other three). The card's own colour is the one it wants.
     */
    background: "var(--c-surface)",
  };

  /* A press on an event selects it, or opens its card (lib/calendar-selection). */
  function pressEvent(e: React.MouseEvent, occ: EventOccurrence) {
    const key = occurrenceKey(occ);
    onEventSelect(key);
    if (pressOutcome(key, selectedKey, pressKind(e.detail, pointerTypeRef.current)) === "open") {
      onEventOpen(occ.event, occ.occurrence);
    }
  }

  function doublePressEvent(e: React.MouseEvent, occ: EventOccurrence) {
    e.stopPropagation();
    if (doubleClickOpens(pressKind(e.detail, pointerTypeRef.current))) onEventOpen(occ.event, occ.occurrence);
  }

  return (
    <div
      ref={rootRef}
      data-calendar-surface
      onPointerDownCapture={(e) => {
        pointerTypeRef.current = e.pointerType;
        pressedAwayRef.current = selectedKey !== null && !(e.target as Element).closest("[data-event-key]");
        if (pressedAwayRef.current) onEventSelect(null);
      }}
      style={{
        "--current-time-offset": `${currentTimeTop()}px`,
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0%",
        minHeight: 0,
        overflow: "hidden",
      } as React.CSSProperties}
    >
      {/*
        * One scroller for both axes, which is what makes the gutters stick.
        *
        * The hour gutter used to live inside a second, inner scroller that
        * owned the vertical axis. position: sticky resolves against the
        * nearest scroll container, so left: 0 resolved against that inner
        * element — which never scrolls horizontally — and the gutter simply
        * travelled with the strip. Measured: at scrollLeft 2934 the whole
        * time-grid body sat at x = -2917, so every hour label was off-screen
        * the moment you scrolled a single day. Scrolling both axes here means
        * the gutter sticks left and the header block sticks top, against the
        * same scrollport.
        */}
      <div
        ref={scrollerRef}
        className="hide-scrollbar"
        onScroll={handleGridScroll}
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          overflow: "auto",
          /*
           * none, not contain. contain stops the scroll chaining to the page
           * but still allows this element its own rubber band, and on a
           * trackpad that band is what let the grid be dragged past both ends
           * — the header block travelling down with it, because a sticky box
           * follows the scrollport and the scrollport itself is what moves
           * during an overscroll. none removes the affordance entirely, so
           * the top is the top and the bottom is the bottom.
           */
          overscrollBehavior: "none",
          scrollbarWidth: "none",
          /*
           * No scroll-snap here. CSS proximity snapping reads as the glitch it
           * was reported as: Chrome picks its own threshold — measured pulling
           * from two fifths of a column away — applies it about a second after
           * the gesture ends, as one unanimated jump, and re-runs it every
           * time the strip is extended. runSettle does the same job on terms
           * this grid controls.
           */
        }}
      >
        <div
          style={{
            width: gutterWidth + stripWidth,
            display: "flex",
            flexDirection: "column",
            /* The grid runs under the dock to the foot of the screen; this
               lets the last hour still scroll up clear of it. */
            paddingBottom: DOCK_ROOM,
          }}
        >
          {/*
            * Day names, tasks and all-day in one sticky block, so only one
            * offset has to be right rather than three stacked ones. It needs
            * an opaque background or the grid scrolls through it.
            */}
          <div
            ref={headerStackRef}
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              background: "var(--c-surface)",
            }}
          >
          {/* Column headers */}
          <div style={{ display: "flex", flexShrink: 0, borderBottom: "1px solid var(--c-border)" }}>
            <div style={stickyGutterStyle} />
            <div style={{ display: "flex", width: stripWidth, flexShrink: 0 }}>
              {days.map((day) => {
                const today = isToday(day);
                return (
                  <div
                    key={toDateStr(day)}
                    style={{
                      width: columnWidth,
                      flex: "0 0 auto",
                      background: weekendCellBackground(day),
                      textAlign: "center",
                      padding: narrow ? "6px 2px 5px" : "8px 4px 6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      borderLeft: "1px solid var(--c-border-sub)",
                    }}
                  >
                    {/*
                      * Today is a tag around the whole heading — name and
                      * number together — rather than a disc around the number
                      * with the name tinted beside it. The wrapper is always
                      * rendered so every column keeps the same geometry and
                      * nothing shifts on the day it becomes today.
                      */}
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        /* Name over number when a column is too narrow for both in a line. */
                        flexDirection: narrow ? "column" : "row",
                        gap: narrow ? 1 : 6,
                        padding: narrow ? "3px 5px" : "3px 9px",
                        borderRadius: "var(--ui-radius-item)",
                        background: today ? "var(--c-accent-strong)" : "transparent",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--ui-type-caption)",
                          color: today ? "var(--cal-today-text)" : "var(--c-text-4)",
                          fontWeight: today ? 600 : 500,
                          textTransform: "uppercase",
                          letterSpacing: 0,
                        }}
                      >
                        {DAYS_SHORT[day.getDay()]}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--ui-type-body)",
                          fontWeight: today ? 700 : 500,
                          color: today ? "var(--cal-today-text)" : "var(--c-text-2)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {day.getDate()}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tasks row, when the page has tasks to show (CronCal has none of its own). */}
          {tasks && (
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--c-border)",
                flexShrink: 0,
                minHeight: TASK_ROW_MIN_HEIGHT,
              }}
            >
              <div
                style={{
                  ...stickyGutterStyle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 8,
                }}
              >
                <span style={{ fontSize: "var(--ui-type-micro)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0, color: "var(--c-text-2)" }}>Tasks</span>
              </div>
              <div style={{ display: "flex", width: stripWidth, flexShrink: 0 }}>
                {days.map((day) => {
                  const dayStr = toDateStr(day);
                  const dayTasks = tasksByDay.get(dayStr) ?? NO_TASKS;
                  const visible = dayTasks.slice(0, MAX_VISIBLE_TASKS);
                  const hidden = dayTasks.slice(MAX_VISIBLE_TASKS);

                  return (
                    <div
                      key={dayStr}
                      style={{
                        width: columnWidth,
                        flex: "0 0 auto",
                        minWidth: 0,
                        background: weekendCellBackground(day),
                        borderLeft: "1px solid var(--c-border-sub)",
                        padding: "4px 4px 3px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        overflow: "hidden",
                        minHeight: TASK_ROW_MIN_HEIGHT,
                      }}
                    >
                      {/*
                        * A pill cut to "Fi..." says nothing, so a narrow column
                        * shows how many tasks are due instead, in the colour of
                        * the most important of them. Day view has the room for
                        * the titles.
                        */}
                      {narrow && dayTasks.length > 0 && (
                        <div
                          role="img"
                          aria-label={`${dayTasks.length} ${dayTasks.length === 1 ? "task" : "tasks"} due: ${dayTasks.map((t) => t.title).join(", ")}`}
                          title={dayTasks.map((t) => t.title).join("\n")}
                          className={wash.wash}
                          style={{
                            fontSize: "var(--ui-type-micro)",
                            padding: "1px 0",
                            borderRadius: "var(--ui-radius-round)",
                            background: priorityFill(taskHue(dayTasks[0].priority)),
                            border: `1px solid ${priorityLine(taskHue(dayTasks[0].priority))}`,
                            color: "var(--c-text-1)",
                            fontWeight: 600,
                            lineHeight: "16px",
                            textAlign: "center",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {dayTasks.length}
                        </div>
                      )}
                      {/*
                        * Each pill in its priority's colour, the fill and edge
                        * of the task's row on /tasks.
                        */}
                      {!narrow && visible.map((task) => (
                        <div
                          key={task.id}
                          title={task.title}
                          className={wash.wash}
                          style={{
                            fontSize: "var(--ui-type-micro)",
                            padding: "1px 6px",
                            borderRadius: "var(--ui-radius-round)",
                            background: priorityFill(taskHue(task.priority)),
                            border: `1px solid ${priorityLine(taskHue(task.priority))}`,
                            color: "var(--c-text-1)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontWeight: 600,
                            lineHeight: "16px",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        >
                          {task.title}
                        </div>
                      ))}
                      {!narrow && hidden.length > 0 && (
                        <div
                          title={hidden.map((t) => t.title).join("\n")}
                          style={{ fontSize: "var(--ui-type-micro)", color: "var(--c-text-4)", paddingLeft: 4, lineHeight: "14px" }}
                        >
                          +{hidden.length} more
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* All-day events row */}
          {hasAllDayEvents && (
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid var(--c-border)",
                flexShrink: 0,
                minHeight: 28,
              }}
            >
              <div
                style={{
                  ...stickyGutterStyle,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "flex-end",
                  paddingRight: 8,
                  paddingTop: 4,
                }}
              >
                <span style={{ fontSize: "var(--ui-type-micro)", color: "var(--c-text-4)", whiteSpace: "nowrap" }}>all-day</span>
              </div>
              <div style={{ display: "flex", width: stripWidth, flexShrink: 0 }}>
                {days.map((day) => {
                  const allDayEvents = dayRenderData.get(toDateStr(day))?.allDayEvents ?? [];
                  return (
                    <div
                      key={toDateStr(day)}
                      style={{
                        width: columnWidth,
                        flex: "0 0 auto",
                        background: weekendCellBackground(day),
                        borderLeft: "1px solid var(--c-border-sub)",
                        padding: "2px 3px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {allDayEvents.map((occ, j) => {
                        const selected = selectedKey === occurrenceKey(occ);
                        return (
                        <button
                          type="button"
                          key={`${occ.event.id}-${occ.start.toISOString()}-${j}`}
                          className={eventStyles.event}
                          aria-label={`Open ${occ.event.title}`}
                          data-event-key={occurrenceKey(occ)}
                          onClick={(e) => pressEvent(e, occ)}
                          onDoubleClick={(e) => doublePressEvent(e, occ)}
                          style={{
                            /* The same tint and ink as a timed event. It was
                               the colour on the colour at 73%: orange text on
                               orange, 1.6:1. Selected, it fills solid. */
                            background: selected ? contentFill(occ.event.color) : eventFill(occ.event.color),
                            borderLeft: `3px solid ${contentColor(occ.event.color)}`,
                            borderTop: "none",
                            borderRight: "none",
                            borderBottom: "none",
                            borderRadius: "var(--ui-radius-item)",
                            padding: "1px 4px",
                            fontSize: "var(--ui-type-caption)",
                            color: selected ? contentInk(occ.event.color) : eventInk(occ.event.color),
                            cursor: "pointer",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            fontWeight: 500,
                            textAlign: "left",
                            fontFamily: "inherit",
                          }}
                        >
                          {occ.event.title}
                        </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>

          {/*
            * Time grid, flush against the header.
            *
            * There was a 12px spacer here so the midnight label could sit
            * centred on its own hour line without clipping. It read as an
            * unexplained band between the tasks row and the first hour, which
            * is worse than a label sitting just under its line — midnight is
            * the one hour whose line is the grid's own top edge, and it is
            * offset below it for exactly that reason.
            *
            * The -1px pulls the first hour line onto the header's bottom
            * border so the two do not stack into a 2px rule.
            */}
          <div
            ref={gridRef}
            style={{
              height: TOTAL_HEIGHT,
              marginTop: -1,
              position: "relative",
              display: "flex",
              flexShrink: 0,
            }}
            onPointerDown={(event) => { pointerTypeRef.current = event.pointerType; }}
            onMouseDown={handleMouseDown}
            onClick={handleGridClick}
          >
            {/* Time gutter */}
            <div
              style={{
                ...stickyGutterStyle,
                height: TOTAL_HEIGHT,
                userSelect: "none",
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  style={{
                    position: "absolute",
                    top: h === 0 ? 2 : h * HOUR_HEIGHT - 8,
                    /* Centred in the gutter. Right-aligned, "09:00" and
                       "23:00" sat flush to the grid and read as hanging off
                       it rather than labelling it. */
                    left: 0,
                    right: 0,
                    textAlign: "center",
                    fontSize: "var(--ui-type-caption)",
                    color: "var(--c-text-4)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatHour(h, fmt)}
                </div>
              ))}

              {isTodayInView && (
                <div
                  ref={currentTimeLabelRef}
                  style={{
                    position: "absolute",
                    top: "calc(var(--current-time-offset) - 7px)",
                    left: 0,
                    right: 0,
                    textAlign: "center",
                    fontSize: "var(--ui-type-caption)",
                    fontWeight: 600,
                    color: "var(--cal-current-time)",
                    zIndex: 3,
                    background: "var(--c-surface)",
                    padding: "0 2px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatTime(new Date(), fmt)}
                </div>
              )}
            </div>

            {/* Day columns */}
            <div style={{ width: stripWidth, position: "relative", display: "flex", flexShrink: 0 }}>
              {days.map((day, dayIdx) => {
                const dayKey = toDateStr(day);
                const renderData = dayRenderData.get(dayKey);
                const dayEvents = renderData?.timedEvents ?? [];
                const layout = renderData?.layout ?? new Map<EventOccurrence, { col: number; totalCols: number }>();
                const weekend = isWeekend(day);

                return (
                  <div
                    key={dayKey}
                    style={{
                      width: columnWidth,
                      flex: "0 0 auto",
                      position: "relative",
                      borderLeft: "1px solid var(--c-border-sub)",
                      backgroundColor: weekend ? "var(--cal-weekend-bg)" : "var(--cal-weekday-bg)",
                      /*
                       * The hour lines are painted, not built. This was 24
                       * absolutely positioned divs per day, each wrapping a
                       * second one for the half hour — 2,064 nodes over a
                       * 43 day strip, 68% of everything the grid rendered,
                       * all of it recreated whenever the strip changed.
                       */
                      backgroundImage: HOUR_LINE_BACKGROUND,
                    }}
                  >
                    {/* The half-hour rule, dashed by a mask rather than a border. */}
                    <div style={halfHourRuleStyle} />

                    {drag && drag.dayIndex === dayIdx && (() => {
                      const height = ((drag.endMin - drag.startMin) / 60) * HOUR_HEIGHT;
                      return (
                        <div
                          style={{
                            ...SELECTION_BOX,
                            top: (drag.startMin / 60) * HOUR_HEIGHT,
                            height,
                            pointerEvents: "none",
                          }}
                        >
                          {height >= SELECTION_LABEL_MIN_HEIGHT && <span>New event</span>}
                        </div>
                      );
                    })()}

                    {!drag && committedDrag && committedDrag.dayIndex === dayIdx && (() => {
                      const cd = committedDrag;
                      const height = ((cd.endMin - cd.startMin) / 60) * HOUR_HEIGHT;
                      const showLabel =
                        height >= SELECTION_LABEL_MIN_HEIGHT && columnWidth >= SELECTION_LABEL_MIN_WIDTH;

                      const slotDay = days[cd.dayIndex];
                      const slotStart = new Date(slotDay);
                      slotStart.setHours(Math.floor(cd.startMin / 60), cd.startMin % 60, 0, 0);
                      const slotEnd = new Date(slotDay);
                      slotEnd.setHours(Math.floor(cd.endMin / 60), cd.endMin % 60, 0, 0);

                      return (
                        <button
                          type="button"
                          className="ui-hover-opacity-soft"
                          aria-label={`Create event from ${formatTime(slotStart, fmt)} to ${formatTime(slotEnd, fmt)}`}
                          /* Otherwise pressing it would begin a fresh selection underneath. */
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => {
                            setCommittedDrag(null);
                            onSlotSelect(slotStart, slotEnd);
                          }}
                          style={{
                            ...SELECTION_BOX,
                            top: (cd.startMin / 60) * HOUR_HEIGHT,
                            height,
                            cursor: "pointer",
                          }}
                        >
                          <Plus aria-hidden="true" size={13} weight="bold" style={{ flexShrink: 0 }} />
                          {showLabel && <span>Create event</span>}
                        </button>
                      );
                    })()}

                    {moving && moving.dayIndex === dayIdx && (() => {
                      /* Where the event being dragged would land, drawn as the
                         event itself, lifted, with the time it would get. */
                      const ev = moving.occ.event;
                      const top = (moving.startMin / 60) * HOUR_HEIGHT + 1;
                      const height = Math.max(20, (Math.max(15, moving.durationMin) / 60) * HOUR_HEIGHT - 2);
                      const landing = movedTimes(day, moving.startMin, moving.occ.start, moving.occ.end);
                      return (
                        <div
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            top,
                            height,
                            left: "0.5%",
                            width: "98.5%",
                            zIndex: 6,
                            pointerEvents: "none",
                            background: eventFill(ev.color),
                            borderLeft: `3px solid ${contentColor(ev.color)}`,
                            borderRadius: "var(--ui-radius-item)",
                            boxShadow: "var(--shadow-pop)",
                            padding: narrow ? "3px 3px 3px 4px" : "5px 6px 4px 6px",
                            overflow: "hidden",
                            userSelect: "none",
                          }}
                        >
                          <div style={{ fontSize: "var(--ui-type-micro)", fontWeight: 600, color: eventInk(ev.color), lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {ev.title}
                          </div>
                          {height > 30 && !narrow && (
                            <div style={{ fontSize: "var(--ui-type-micro)", color: eventInk(ev.color), marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {formatTime(landing.start, fmt)} - {formatTime(landing.end, fmt)}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {dayEvents.map((occ, j) => {
                      const pos = layout.get(occ) ?? { col: 0, totalCols: 1 };
                      const startMin = minutesFromDayStart(occ.renderStart, day);
                      const endMin = minutesFromDayStart(occ.renderEnd, day);
                      const durationMin = Math.max(15, endMin - startMin);
                      const top = (startMin / 60) * HOUR_HEIGHT + 1;
                      const height = Math.max(20, (durationMin / 60) * HOUR_HEIGHT - 2);
                      const colWidth = 100 / pos.totalCols;
                      const left = colWidth * pos.col;
                      const showTime = height > 30;
                      const isPast = occ.end.getTime() < Date.now();
                      const beingMoved = moving?.key === occurrenceKey(occ);
                      /* Selected: solid in its own colour, its title in the ink that reads on it, above its neighbours. */
                      const selected = selectedKey === occurrenceKey(occ);
                      const ink = selected ? contentInk(occ.event.color) : isPast ? "var(--c-text-2)" : eventInk(occ.event.color);

                      return (
                        <button
                          type="button"
                          key={`${occ.event.id}-${occ.start.toISOString()}-${j}`}
                          className={[isPast ? null : eventStyles.event, beingMoved ? eventStyles.moving : null].filter(Boolean).join(" ") || undefined}
                          aria-label={`Open ${occ.event.title}, ${formatTime(occ.renderStart, fmt)} to ${formatTime(occ.renderEnd, fmt)}`}
                          data-event-key={occurrenceKey(occ)}
                          onMouseDown={(e) => handleEventMouseDown(e, occ, dayIdx, day)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (suppressEventClickRef.current) return;
                            pressEvent(e, occ);
                          }}
                          onDoubleClick={(e) => doublePressEvent(e, occ)}
                          style={{
                            position: "absolute",
                            top,
                            height,
                            left: `${left + 0.5}%`,
                            width: `${colWidth - 1.5}%`,
                            background: selected ? contentFill(occ.event.color) : eventFill(occ.event.color, isPast),
                            /* The pure colour stays on the edge, past or not,
                               so an event is still recognisably its colour. */
                            borderLeft: `3px solid ${selected ? contentFill(occ.event.color) : contentColor(occ.event.color)}`,
                            borderRadius: "var(--ui-radius-item)",
                            padding: narrow ? "3px 3px 3px 4px" : "5px 6px 4px 6px",
                            cursor: "pointer",
                            zIndex: selected ? 2 : 1,
                            overflow: "hidden",
                            userSelect: "none",
                            boxShadow: "var(--cal-event-shadow)",
                            /* A finished event is quieter by its fill and its
                               neutral text, never by opacity: at 0.55 its
                               title fell to 1.9 to 2.5:1. */
                            borderTop: "none",
                            borderRight: "none",
                            borderBottom: "none",
                            textAlign: "left",
                            fontFamily: "inherit",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "var(--ui-type-micro)",
                              fontWeight: 600,
                              color: ink,
                              lineHeight: 1.15,
                              /*
                               * A narrow column wraps the title down the block
                               * instead of cutting it to two letters: the block
                               * is tall, it is the width that is missing. Words
                               * are not split; one too long is clipped whole.
                               */
                              whiteSpace: narrow ? "normal" : "nowrap",
                              textOverflow: "ellipsis",
                              overflow: "hidden",
                            }}
                          >
                            {occ.event.title}
                          </div>
                          {showTime && !narrow && (
                            <div style={{ fontSize: "var(--ui-type-micro)", color: ink, fontWeight: 400, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {formatTime(occ.renderStart, fmt)} - {formatTime(occ.renderEnd, fmt)}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {isTodayInView && (
                <>
                  <div
                    style={{
                      position: "absolute",
                      top: "var(--current-time-offset)",
                      left: 0,
                      right: 0,
                      height: 1,
                      background: "var(--cal-current-time)",
                      opacity: 0.25,
                      zIndex: 10,
                      pointerEvents: "none",
                    }}
                  />
                  {/*
                    * Now, across today: a red rule and its dot, each inside a
                    * border the colour of the grid behind them, so the line
                    * stays a clean line over whatever event it crosses (the
                    * owner, 13 Oct 2026: a finished border, not a shadow).
                    * The border is a ring with no blur, in --c-surface, and on
                    * a weekend with the weekend's shade laid over it, the
                    * same two layers the column itself is drawn in.
                    */}
                  <div
                    style={{
                      position: "absolute",
                      /* 2px centred where the 1px rule was: half a pixel up. */
                      top: "calc(var(--current-time-offset) - 0.5px)",
                      left: `${todayColIndex * columnWidth}px`,
                      width: columnWidth,
                      height: 2,
                      borderRadius: "var(--ui-radius-round)",
                      background: "var(--cal-current-time)",
                      boxShadow: nowBorder(1.5),
                      zIndex: 10,
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      /* 8px on the 2px rule: its centre on the rule's. */
                      top: "calc(var(--current-time-offset) - 3.5px)",
                      left: `${todayColIndex * columnWidth - 4}px`,
                      width: 8,
                      height: 8,
                      borderRadius: "var(--ui-radius-round)",
                      background: "var(--cal-current-time)",
                      boxShadow: nowBorder(2),
                      zIndex: 10,
                      pointerEvents: "none",
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
