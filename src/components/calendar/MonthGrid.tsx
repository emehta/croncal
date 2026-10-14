"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarEvent } from "@/types/calendar-event";
import { getAllOccurrencesInRange, type CalendarOccurrence } from "@/lib/calendar-occurrence-utils";
import { addDays, isToday, startOfDay, toDateStr } from "@/lib/date-utils";
import { getWeekRange, orderWeekdays, useWeekStart, type WeekStartPreference } from "@/lib/week-start";
import { eventFill, eventInk } from "@/lib/styles";
import eventStyles from "./CalendarEvents.module.css";
import { contentColor, contentFill, contentInk } from "@/lib/content-palette";
import { doubleClickOpens, occurrenceKey, pressKind, pressOutcome } from "@/lib/calendar-selection";

interface MonthGridProps {
  currentDate: Date;
  events: CalendarEvent[];
  /** The occurrence selected (lib/calendar-selection's key), drawn solid. */
  selectedKey: string | null;
  /** A press selected an occurrence, or a press away put the selection down (null). */
  onEventSelect: (key: string | null) => void;
  /** An event's card asked for: a double click, a second tap, or a key. */
  onEventOpen: (event: CalendarEvent, occurrence?: { start: Date; end: Date }) => void;
  onDateClick: (date: Date) => void;
  /** Reports the month the viewport has settled over, as its first day. */
  onDateChange?: (date: Date) => void;
}

const DAYS_HEADER_SUNDAY_FIRST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A week row is a fixed height so the scroll arithmetic is exact.
 *
 * The month used to be six rows of `flex: 1` inside a container that only
 * scrolled if they overflowed — which they never did, so scrolling up or down
 * did nothing at all and the only way to change month was the arrows. A fixed
 * row height turns the month into a strip that can be scrolled through the way
 * the week view is scrolled sideways.
 */
const ROW_HEIGHT = 116;

/** Weeks held either side of the anchor month whenever the strip is built. */
const BUFFER_WEEKS = 10;
const EDGE_THRESHOLD_ROWS = 3;
const EXTENSION_WEEKS = 6;
/** Past this the strip is rebuilt around where you are, while the scroll is idle. */
const MAX_STRIP_WEEKS = 40;
/** Quiet on the scroll event that counts as the gesture having stopped. */
const SCROLL_IDLE_MS = 150;

function weekStartOf(date: Date, weekStart: WeekStartPreference): Date {
  return startOfDay(getWeekRange(date, weekStart).start);
}

function buildStrip(anchor: Date, weekStart: WeekStartPreference): { start: Date; end: Date } {
  const anchorWeek = weekStartOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1), weekStart);
  return {
    start: addDays(anchorWeek, -BUFFER_WEEKS * 7),
    end: addDays(anchorWeek, BUFFER_WEEKS * 7),
  };
}

function enumerateWeeks(start: Date, end: Date): Date[] {
  const weeks: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    weeks.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

export default function MonthGrid({
  currentDate,
  events,
  selectedKey,
  onEventSelect,
  onEventOpen,
  onDateClick,
  onDateChange,
}: MonthGridProps) {
  const weekStart = useWeekStart();
  const dayHeaders = orderWeekdays(DAYS_HEADER_SUNDAY_FIRST, weekStart);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const pointerTypeRef = useRef<string>("mouse");
  const pendingPrependWeeksRef = useRef(0);
  const prependPendingRef = useRef(false);
  const appendPendingRef = useRef(false);
  const pendingScrollWeekKeyRef = useRef<string | null>(null);
  const pendingScrollOffsetRef = useRef(0);
  const reportedMonthKeyRef = useRef<string | null>(null);
  /** Set once the strip has been positioned, so the runway check can start. */
  const hasPositionedRef = useRef(false);
  const selfReportedMonthKeyRef = useRef<string | null>(null);
  const userScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weeksRef = useRef<Date[]>([]);
  const scrollFrameRef = useRef<number | null>(null);

  const [strip, setStrip] = useState(() => buildStrip(currentDate, weekStart));
  const weeks = useMemo(() => enumerateWeeks(strip.start, strip.end), [strip]);
  const weeksKey = useMemo(() => weeks.map(toDateStr).join("|"), [weeks]);

  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const visibleMonth = currentDate.getMonth();

  useEffect(() => {
    weeksRef.current = weeks;
  });

  const releaseProgrammaticScroll = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
  }, []);

  /* Every occurrence bucketed onto the days it covers, in one pass. */
  const occurrencesByDay = useMemo(() => {
    const rangeStart = startOfDay(strip.start);
    const rangeEnd = addDays(startOfDay(strip.end), 7);
    rangeEnd.setHours(23, 59, 59, 999);

    const byDay = new Map<string, CalendarOccurrence[]>();
    /*
     * getOccurrencesForDay expanded every event over the whole range and threw
     * all but one day away, once per cell. Forty-two cells meant forty-two
     * expansions of the same list; a scrolling strip would have meant hundreds.
     */
    for (const occurrence of getAllOccurrencesInRange(events, rangeStart, rangeEnd)) {
      const cursor = startOfDay(occurrence.start < rangeStart ? rangeStart : occurrence.start);
      while (cursor < occurrence.end || cursor.getTime() === startOfDay(occurrence.start).getTime()) {
        if (cursor > rangeEnd) break;
        const key = toDateStr(cursor);
        const bucket = byDay.get(key);
        if (bucket) bucket.push(occurrence);
        else byDay.set(key, [occurrence]);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return byDay;
  }, [events, strip]);

  /** The month sitting over the middle of the viewport. */
  const monthAtViewportCentre = useCallback((): Date | null => {
    const el = scrollerRef.current;
    const currentWeeks = weeksRef.current;
    if (!el || currentWeeks.length === 0) return null;

    const centre = el.scrollTop + el.clientHeight / 2;
    const row = Math.max(0, Math.min(currentWeeks.length - 1, Math.floor(centre / ROW_HEIGHT)));
    // The midweek day, so a week split across two months resolves to the one
    // that owns most of it.
    const midweek = addDays(currentWeeks[row], 3);
    return new Date(midweek.getFullYear(), midweek.getMonth(), 1);
  }, []);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el || programmaticScrollRef.current) return;

    userScrollingRef.current = true;
    if (scrollIdleTimerRef.current !== null) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      scrollIdleTimerRef.current = null;
      userScrollingRef.current = false;
      trimStripIfOversized();
    }, SCROLL_IDLE_MS);

    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;

      const element = scrollerRef.current;
      const currentWeeks = weeksRef.current;
      if (!element || currentWeeks.length === 0) return;

      const month = monthAtViewportCentre();
      if (month && onDateChange) {
        const key = `${month.getFullYear()}-${month.getMonth()}`;
        if (key !== reportedMonthKeyRef.current) {
          reportedMonthKeyRef.current = key;
          selfReportedMonthKeyRef.current = key;
          onDateChange(month);
        }
      }

      const topRow = Math.floor(element.scrollTop / ROW_HEIGHT);
      if (topRow <= EDGE_THRESHOLD_ROWS && !prependPendingRef.current) {
        prependPendingRef.current = true;
        pendingPrependWeeksRef.current += EXTENSION_WEEKS;
        setStrip((prev) => ({ ...prev, start: addDays(prev.start, -EXTENSION_WEEKS * 7) }));
      }

      const rowsBelow = currentWeeks.length - Math.ceil((element.scrollTop + element.clientHeight) / ROW_HEIGHT);
      if (rowsBelow <= EDGE_THRESHOLD_ROWS && !appendPendingRef.current) {
        appendPendingRef.current = true;
        setStrip((prev) => ({ ...prev, end: addDays(prev.end, EXTENSION_WEEKS * 7) }));
      }
    });
  }

  const trimStripIfOversized = useCallback(() => {
    const el = scrollerRef.current;
    const currentWeeks = weeksRef.current;
    if (!el || currentWeeks.length <= MAX_STRIP_WEEKS) return;
    if (pendingScrollWeekKeyRef.current || pendingPrependWeeksRef.current > 0) return;

    const topRow = Math.max(0, Math.min(currentWeeks.length - 1, Math.round(el.scrollTop / ROW_HEIGHT)));
    const topWeek = currentWeeks[topRow];
    if (!topWeek) return;

    pendingScrollWeekKeyRef.current = toDateStr(topWeek);
    pendingScrollOffsetRef.current = el.scrollTop - topRow * ROW_HEIGHT;
    prependPendingRef.current = false;
    appendPendingRef.current = false;
    setStrip({
      start: addDays(topWeek, -BUFFER_WEEKS * 7),
      end: addDays(topWeek, BUFFER_WEEKS * 7),
    });
  }, []);

  useEffect(() => {
    appendPendingRef.current = false;
  }, [strip.end]);

  useEffect(() => () => {
    if (scrollIdleTimerRef.current !== null) clearTimeout(scrollIdleTimerRef.current);
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  /*
   * An external month change — the arrows, Today, switching into this view —
   * rebuilds the strip around it. A month this grid reported itself is already
   * on screen, so it is left alone.
   */
  useLayoutEffect(() => {
    if (selfReportedMonthKeyRef.current === monthKey) return;
    if (userScrollingRef.current) return;

    selfReportedMonthKeyRef.current = null;
    reportedMonthKeyRef.current = monthKey;

    const frame = requestAnimationFrame(() => {
      const anchorWeek = weekStartOf(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), weekStart);
      pendingScrollWeekKeyRef.current = toDateStr(anchorWeek);
      pendingScrollOffsetRef.current = 0;
      pendingPrependWeeksRef.current = 0;
      prependPendingRef.current = false;
      appendPendingRef.current = false;
      setStrip(buildStrip(currentDate, weekStart));
    });

    return () => cancelAnimationFrame(frame);
  }, [currentDate, monthKey, weekStart]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    if (pendingPrependWeeksRef.current > 0) {
      const added = pendingPrependWeeksRef.current;
      pendingPrependWeeksRef.current = 0;
      programmaticScrollRef.current = true;
      el.scrollTop += added * ROW_HEIGHT;
      prependPendingRef.current = false;
      releaseProgrammaticScroll();
      return;
    }

    const key = pendingScrollWeekKeyRef.current;
    if (!key) return;

    const index = weeks.findIndex((week) => toDateStr(week) === key);
    if (index < 0) return;

    programmaticScrollRef.current = true;
    el.scrollTop = index * ROW_HEIGHT + pendingScrollOffsetRef.current;
    pendingScrollWeekKeyRef.current = null;
    pendingScrollOffsetRef.current = 0;
    hasPositionedRef.current = true;
    releaseProgrammaticScroll();
  }, [releaseProgrammaticScroll, weeks, weeksKey]);

  /*
   * Keep runway at both ends, without waiting for a scroll event to ask.
   *
   * Extending only from the scroll handler is one missed event away from a
   * dead end: land exactly on the last row and there is nothing left to
   * scroll, so no further event fires and the strip can never grow. Reached
   * that way the month view simply stopped, and only scrolling back up freed
   * it. Checked after every render of the strip as well, which converges —
   * each extension adds more rows than the threshold asks for.
   */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || weeks.length === 0 || !hasPositionedRef.current) return;
    if (pendingScrollWeekKeyRef.current || pendingPrependWeeksRef.current > 0) return;

    const frame = requestAnimationFrame(() => {
      const element = scrollerRef.current;
      if (!element) return;

      if (Math.floor(element.scrollTop / ROW_HEIGHT) <= EDGE_THRESHOLD_ROWS && !prependPendingRef.current) {
        prependPendingRef.current = true;
        pendingPrependWeeksRef.current += EXTENSION_WEEKS;
        setStrip((prev) => ({ ...prev, start: addDays(prev.start, -EXTENSION_WEEKS * 7) }));
        return;
      }

      const rowsBelow = weeks.length - Math.ceil((element.scrollTop + element.clientHeight) / ROW_HEIGHT);
      if (rowsBelow <= EDGE_THRESHOLD_ROWS && !appendPendingRef.current) {
        appendPendingRef.current = true;
        setStrip((prev) => ({ ...prev, end: addDays(prev.end, EXTENSION_WEEKS * 7) }));
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [weeks, weeksKey]);

  /* A press on an event selects it, or opens its card (lib/calendar-selection). */
  function pressEvent(e: React.MouseEvent, occ: CalendarOccurrence) {
    e.stopPropagation();
    const key = occurrenceKey(occ.event.id, occ.start);
    onEventSelect(key);
    if (pressOutcome(key, selectedKey, pressKind(e.detail, pointerTypeRef.current)) === "open") {
      onEventOpen(occ.event, occ.occurrence);
    }
  }

  function doublePressEvent(e: React.MouseEvent, occ: CalendarOccurrence) {
    e.stopPropagation();
    if (doubleClickOpens(pressKind(e.detail, pointerTypeRef.current))) onEventOpen(occ.event, occ.occurrence);
  }

  return (
    <div
      data-calendar-surface
      onPointerDownCapture={(e) => {
        pointerTypeRef.current = e.pointerType;
        // A press anywhere but an event puts the selection down; a day's own
        // click still goes on to open that day.
        if (selectedKey !== null && !(e.target as Element).closest("[data-event-key]")) onEventSelect(null);
      }}
      style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", minHeight: 0, overflow: "hidden" }}
    >
      {/* Day headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: "1px solid var(--c-border)",
          flexShrink: 0,
        }}
      >
        {dayHeaders.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              padding: "8px 4px",
              fontSize: "var(--ui-type-caption)",
              fontWeight: 500,
              color: "var(--c-text-3)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      <div
        ref={scrollerRef}
        className="hide-scrollbar"
        onScroll={handleScroll}
        role="grid"
        aria-label={`${currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })} calendar`}
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          /* As in the week view: contain still grants a rubber band of its
             own, and this strip has no ends worth bouncing off. */
          overscrollBehavior: "none",
          scrollbarWidth: "none",
        }}
      >
        {weeks.map((week) => (
          <div
            key={toDateStr(week)}
            role="row"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              height: ROW_HEIGHT,
              flexShrink: 0,
            }}
          >
            {Array.from({ length: 7 }, (_, colIdx) => {
              const day = addDays(week, colIdx);
              const inMonth = day.getMonth() === visibleMonth;
              const today = isToday(day);
              const dayEvents = occurrencesByDay.get(toDateStr(day)) ?? [];
              const visible = dayEvents.slice(0, 3);
              const overflow = dayEvents.length - 3;

              return (
                <div
                  key={colIdx}
                  role="gridcell"
                  style={{
                    borderLeft: colIdx === 0 ? "none" : "1px solid var(--c-border-sub)",
                    borderTop: "1px solid var(--c-border-sub)",
                    padding: "6px 6px",
                    background: "transparent",
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  {/*
                    * Everything in a day outside the month on screen is faded
                    * together — number, events and the overflow count.
                    *
                    * Dimming only the number was not enough to tell you which
                    * month you were looking at: the strip runs continuously
                    * through them now, so a screen showing mostly October has
                    * a row of September in it, and those events were as loud
                    * as October's. The opacity is on a wrapper rather than the
                    * cell so the grid lines keep their strength.
                    */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      flex: 1,
                      minHeight: 0,
                      opacity: inMonth ? 1 : 0.4,
                      transition: "opacity var(--motion-base) var(--ease-out)",
                    }}
                  >
                  {/* Date number */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
                    <button
                      type="button"
                      aria-label={`Open ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                      aria-current={today ? "date" : undefined}
                      onClick={() => onDateClick(day)}
                      style={{
                        fontSize: "var(--ui-type-body-sm)",
                        fontWeight: today ? 700 : 400,
                        /*
                         * The same tag today wears in the week view's heading
                         * and the mini calendar. It was a hardcoded #3b82f6
                         * disc with #fff on it — a blue belonging to no theme,
                         * and the only circle left in the calendar.
                         */
                        color: today ? "var(--cal-today-text)" : inMonth ? "var(--c-text-2)" : "var(--c-text-4)",
                        background: today ? "var(--c-accent-strong)" : "transparent",
                        borderRadius: "var(--ui-radius-item)",
                        minWidth: 22,
                        height: 22,
                        padding: "0 6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {day.getDate()}
                    </button>
                  </div>

                  {/* Event pills */}
                  {visible.map((occ, i) => {
                    const key = occurrenceKey(occ.event.id, occ.start);
                    const selected = selectedKey === key;
                    return (
                    <button
                      type="button"
                      key={i}
                      className={eventStyles.event}
                      aria-label={`Open ${occ.event.title}`}
                      data-event-key={key}
                      onClick={(e) => pressEvent(e, occ)}
                      onDoubleClick={(e) => doublePressEvent(e, occ)}
                      style={{
                        background: selected ? contentFill(occ.event.color) : eventFill(occ.event.color),
                        borderRadius: "var(--ui-radius-item)",
                        padding: "1px 5px",
                        fontSize: "var(--ui-type-micro)",
                        fontWeight: 600,
                        color: selected ? contentInk(occ.event.color) : eventInk(occ.event.color),
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        borderLeft: `2px solid ${selected ? contentFill(occ.event.color) : contentColor(occ.event.color)}`,
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        borderTop: "none",
                        borderRight: "none",
                        borderBottom: "none",
                        textAlign: "left",
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                        {occ.event.title}
                      </span>
                    </button>
                    );
                  })}

                  {overflow > 0 && (
                    <button
                      type="button"
                      className="ui-hover-text"
                      aria-label={`Open ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} to view ${overflow} more event${overflow === 1 ? "" : "s"}`}
                      onClick={() => onDateClick(day)}
                      style={{
                        alignSelf: "flex-start",
                        background: "transparent",
                        border: "none",
                        color: "var(--c-text-4)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "var(--ui-type-caption)",
                        padding: "0 0 0 2px",
                      }}
                    >
                      +{overflow} more
                    </button>
                  )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
