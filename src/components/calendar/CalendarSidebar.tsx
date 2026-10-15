"use client";

import { useMemo } from "react";
import { CaretLeft, CaretRight, Eye, EyeSlash } from "@phosphor-icons/react";
import GoogleBrandIcon from "@/components/GoogleBrandIcon";
import { openSettings } from "@/lib/open-settings";
import { countOccurrencesInRange, getAllOccurrencesInRange } from "@/lib/calendar-occurrence-utils";
import { MONTHS_SHORT, isSameDay, startOfDay } from "@/lib/date-utils";
import { CALENDAR_SIDEBAR_WIDTH } from "@/lib/styles";
import { CalendarEvent } from "@/types/calendar-event";
import { isInWindow, type DayWindow } from "@/lib/calendar-range";
import { getWeekRange, orderWeekdays, useWeekStart, type WeekStartPreference } from "@/lib/week-start";

const DAYS_LABEL_SUNDAY_FIRST = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getMonthGrid(
  year: number,
  month: number,
  weekStart: WeekStartPreference,
): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = weekStart === "monday" ? 1 : 0;
  const startDay = (first.getDay() - startDow + 7) % 7;
  const totalDays = last.getDate();

  const weeks: (Date | null)[][] = [];
  let week: (Date | null)[] = [];

  // leading nulls
  for (let i = 0; i < startDay; i++) week.push(null);

  for (let d = 1; d <= totalDays; d++) {
    week.push(new Date(year, month, d));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  // trailing nulls
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return weeks;
}

interface CalendarSidebarProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDateChange: (date: Date) => void;
  /** "connected" shows the switch; "reconnect" shows the prompt instead. */
  googleStatus: "checking" | "connected" | "disconnected" | "reconnect";
  showGoogleEvents: boolean;
  onToggleGoogleEvents: () => void;
  onReconnectGoogle: () => void;
  /** Reconnect was pressed and the page is on its way to Google. */
  reconnectingGoogle?: boolean;
  /** Laid out under the grid on a phone, full width with larger targets. */
  stacked?: boolean;
  /**
   * The days the week grid has on screen, shaded in the mini calendar. Null
   * outside week view, where the row holding today is shaded instead.
   */
  highlightWindow?: DayWindow | null;
}

/**
 * A bordered row in the sidebar's lower stack: the three stat rows and the
 * Google row share one shape, one minimum height and no extra margin, so they
 * sit evenly and stand the same height.
 */
const SIDEBAR_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 10px",
  /*
   * 34 is what the stat rows come to on their own: their value is set in
   * --ui-type-body-sm, which is a taller line than anything in the Google
   * row. Naming it here is what makes all four exactly the same height
   * instead of two pixels apart.
   */
  minHeight: 34,
  background: "var(--c-surface)",
  border: "1px solid var(--c-border)",
  borderRadius: "var(--ui-radius-md)",
};

/*
 * The shade behind the days in view: a wash of the theme's own accent.
 */
const RANGE_SHADE = "color-mix(in srgb, var(--c-accent) 14%, transparent)";

export default function CalendarSidebar({
  currentDate,
  events,
  onDateChange,
  googleStatus,
  showGoogleEvents,
  onToggleGoogleEvents,
  onReconnectGoogle,
  reconnectingGoogle = false,
  stacked = false,
  highlightWindow = null,
}: CalendarSidebarProps) {
  const weekStart = useWeekStart();
  const checkingGoogle = googleStatus === "checking";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Event stats
  const eventStats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const week = getWeekRange(currentDate, weekStart);
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

    const todayCount = countOccurrencesInRange(events, todayStart, todayEnd);
    const weekCount = countOccurrencesInRange(events, week.start, week.end);
    const monthCount = countOccurrencesInRange(events, monthStart, monthEnd);
    return { todayCount, weekCount, monthCount };
  }, [events, currentDate, weekStart]);

  const [miniYear, miniMonth] = useMemo(() => {
    return [currentDate.getFullYear(), currentDate.getMonth()];
  }, [currentDate]);

  const weeks = useMemo(
    () => getMonthGrid(miniYear, miniMonth, weekStart),
    [miniYear, miniMonth, weekStart],
  );
  const dayLabels = orderWeekdays(DAYS_LABEL_SUNDAY_FIRST, weekStart);

  // Determine which dates have events
  const eventDates = useMemo(() => {
    const set = new Set<string>();
    const rangeStart = new Date(miniYear, miniMonth, 1);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(miniYear, miniMonth + 1, 0, 23, 59, 59, 999);

    for (const occurrence of getAllOccurrencesInRange(events, rangeStart, rangeEnd)) {
      const cursor = startOfDay(occurrence.start);
      const lastIncludedInstant = new Date(Math.max(occurrence.start.getTime(), occurrence.end.getTime() - 1));
      const finalDay = startOfDay(lastIncludedInstant);
      while (cursor <= finalDay) {
        if (cursor >= rangeStart && cursor <= rangeEnd) {
          set.add(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return set;
  }, [events, miniYear, miniMonth]);

  function hasEvent(date: Date): boolean {
    return eventDates.has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }

  // Check if a week row contains today
  function isCurrentWeekRow(week: (Date | null)[]): boolean {
    return week.some((d) => d && isSameDay(d, today));
  }

  /* Whether a cell is shaded: a day of the grid's window, or of today's row. */
  function isShaded(date: Date | null, rowHasToday: boolean): boolean {
    if (highlightWindow) return date !== null && isInWindow(date, highlightWindow);
    return rowHasToday;
  }

  function prevMonth() {
    const d = new Date(miniYear, miniMonth - 1, 1);
    onDateChange(d);
  }

  function nextMonth() {
    const d = new Date(miniYear, miniMonth + 1, 1);
    onDateChange(d);
  }

  return (
    <div
      style={{
        width: stacked ? "100%" : CALENDAR_SIDEBAR_WIDTH,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        alignSelf: "stretch",
      }}
    >
      {/* Mini calendar card */}
      <div
        style={{
          padding: "12px 10px",
          background: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          borderRadius: "var(--ui-radius-md)",
          boxShadow: "var(--task-shadow)",
        }}
      >
        {/* Month navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button
            type="button"
            aria-label="Previous month"
            className="ui-hover-text"
            onClick={prevMonth}
            style={{
              width: stacked ? 32 : 22, height: stacked ? 32 : 22, borderRadius: "var(--ui-radius-round)", background: "transparent",
              border: "none", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "var(--c-text-4)",
              transition: "color var(--motion-base) var(--ease-out)",
            }}
          >
            <CaretLeft size={11} weight="bold" />
          </button>
          <span style={{ fontSize: "var(--ui-type-label)", fontWeight: 600, color: "var(--c-text-1)" }}>
            {MONTHS_SHORT[miniMonth]} {miniYear}
          </span>
          <button
            type="button"
            aria-label="Next month"
            className="ui-hover-text"
            onClick={nextMonth}
            style={{
              width: stacked ? 32 : 22, height: stacked ? 32 : 22, borderRadius: "var(--ui-radius-round)", background: "transparent",
              border: "none", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "var(--c-text-4)",
              transition: "color var(--motion-base) var(--ease-out)",
            }}
          >
            <CaretRight size={11} weight="bold" />
          </button>
        </div>

        {/* Day labels + Date grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0 }}>
          {dayLabels.map((lbl) => (
            <div
              key={lbl}
              style={{
                textAlign: "center",
                fontSize: "var(--ui-type-micro)",
                textTransform: "uppercase",
                color: "var(--c-text-4)",
                padding: "0 0 3px",
                fontWeight: 500,
                letterSpacing: "0.04em",
              }}
            >
              {lbl}
            </div>
          ))}

          {weeks.map((week, wi) => {
            const isCurrWeek = isCurrentWeekRow(week);
            return week.map((date, di) => {
              if (!date) {
                return (
                  <div
                    key={`${wi}-${di}`}
                    style={{
                      padding: stacked ? "6px 0" : "2px 0",
                      background: isShaded(null, isCurrWeek) ? RANGE_SHADE : "transparent",
                    }}
                  />
                );
              }
              const isT = isSameDay(date, today);
              const hasEvt = hasEvent(date);

              return (
                <button
                  type="button"
                  key={`${wi}-${di}`}
                  className={isT ? undefined : "ui-hover-fill"}
                  aria-label={`Open ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${hasEvt ? ", has events" : ""}`}
                  aria-current={isT ? "date" : undefined}
                  onClick={() => onDateChange(date)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0,
                    padding: stacked ? "6px 0" : "2px 0",
                    cursor: "pointer",
                    borderRadius: "var(--ui-radius-xs)",
                    border: "none",
                    fontFamily: "inherit",
                    background: isShaded(date, isCurrWeek) ? RANGE_SHADE : "transparent",
                    transition: "background var(--motion-fast) var(--ease-out)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--ui-type-caption)",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: isT ? 700 : 400,
                      color: isT ? "var(--c-on-accent)" : hasEvt ? "var(--c-text-1)" : "var(--c-text-3)",
                      minWidth: 20,
                      height: 20,
                      lineHeight: "20px",
                      padding: "0 5px",
                      textAlign: "center",
                      /* The same shape today wears in the grid heading. */
                      borderRadius: "var(--ui-radius-item)",
                      background: isT ? "var(--c-accent-strong)" : "transparent",
                    }}
                  >
                    {date.getDate()}
                  </span>
                  {/*
                    * The dot's slot is always there, shown or not.
                    *
                    * Rendered only for days that have events, it would grow
                    * the mini calendar by a couple of pixels a row the moment
                    * events arrived, pushing the stat rows and the Google row
                    * down after first paint.
                    */}
                  <div
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: "var(--ui-radius-round)",
                      background: "var(--c-accent)",
                      marginTop: -1,
                      visibility: hasEvt && !isT ? "visible" : "hidden",
                    }}
                  />
                </button>
              );
            });
          })}
        </div>
      </div>

      {/* Event stats */}
      {/* Side by side when stacked: three short rows read as a strip, not a list. */}
      <div
        style={
          stacked
            ? { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 10 }
            : { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }
        }
      >
        {/* Counts, not alarms: red and amber here read as something being wrong. */}
        {[
          { label: "Today", value: eventStats.todayCount, color: "var(--c-text-1)" },
          { label: "This week", value: eventStats.weekCount, color: "var(--c-text-2)" },
          { label: "This month", value: eventStats.monthCount, color: "var(--c-text-2)" },
        ].map((stat) => (
          <div
            key={stat.label}
            style={SIDEBAR_ROW}
          >
            <span style={{ fontSize: "var(--ui-type-caption)", color: "var(--c-text-3)", fontWeight: 400 }}>{stat.label}</span>
            <span style={{ fontSize: "var(--ui-type-body-sm)", fontWeight: 700, color: stat.color }}>{stat.value}</span>
          </div>
        ))}

        {/*
          Google, as a switch rather than a status. Connecting and
          disconnecting live in Settings; what belongs on the calendar is
          whether those events are showing, so that is all this is.

          A dead token is the one thing worth interrupting for, so "reconnect"
          replaces the switch with the prompt. Disconnected shows one quiet
          row that opens Settings, where Google is set up.

          While the status is still being checked the row is drawn anyway, with
          the eye inert: the answer takes two calls out to Google, and the row
          appearing afterwards would shove everything around it.
        */}
        {(googleStatus === "connected" || googleStatus === "checking") && (
          <div style={{ ...SIDEBAR_ROW, gridColumn: stacked ? "1 / -1" : undefined }} aria-busy={googleStatus === "checking"}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <GoogleBrandIcon size={13} />
              <span
                style={{
                  fontSize: "var(--ui-type-caption)",
                  color: checkingGoogle || !showGoogleEvents ? "var(--c-text-4)" : "var(--c-text-2)",
                  whiteSpace: "nowrap",
                  transition: "color var(--motion-base) var(--ease-out)",
                }}
              >
                Google
              </span>
            </span>
            {/*
              This hides and shows events that are already there; it does not
              turn a setting on. A switch says "enabled", an eye says "visible",
              and the second is what the control actually does.
            */}
            <button
              type="button"
              className="ui-hover-control"
              aria-pressed={showGoogleEvents}
              aria-label={showGoogleEvents ? "Hide Google Calendar events" : "Show Google Calendar events"}
              title={showGoogleEvents ? "Hide Google events" : "Show Google events"}
              onClick={onToggleGoogleEvents}
              disabled={checkingGoogle}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                /* Sized to sit inside the row rather than set its height. */
                width: stacked ? 36 : 24,
                height: stacked ? 28 : 18,
                padding: 0,
                borderRadius: "var(--ui-radius-md)",
                background: "transparent",
                /* No box. It is an icon that changes state, not a control
                   that needs an edge drawn round it to be found. */
                border: "none",
                color: checkingGoogle || !showGoogleEvents ? "var(--c-text-4)" : "var(--c-text-1)",
                cursor: checkingGoogle ? "default" : "pointer",
                opacity: checkingGoogle ? 0.5 : 1,
                transition: "color var(--motion-base) var(--ease-out)",
                flexShrink: 0,
              }}
            >
              {showGoogleEvents
                ? <Eye size={14} weight="bold" aria-hidden="true" />
                : <EyeSlash size={14} weight="bold" aria-hidden="true" />}
            </button>
          </div>
        )}

        {/* Disconnected: one quiet row that opens Settings, where the Google client is added and connected. */}
        {googleStatus === "disconnected" && (
          <button
            type="button"
            onClick={() => openSettings("google")}
            className="ui-hover-control"
            style={{
              ...SIDEBAR_ROW,
              gridColumn: stacked ? "1 / -1" : undefined,
              justifyContent: "flex-start",
              gap: 7,
              width: "100%",
              background: "transparent",
              border: "1px solid var(--c-border-sub)",
              color: "var(--c-text-2)",
              fontSize: "var(--ui-type-caption)",
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <GoogleBrandIcon size={13} />
            Connect Google
          </button>
        )}

        {googleStatus === "reconnect" && (
          <button
            type="button"
            onClick={onReconnectGoogle}
            disabled={reconnectingGoogle}
            aria-busy={reconnectingGoogle || undefined}
            className="ui-hover-control"
            style={{
              ...SIDEBAR_ROW,
              gridColumn: stacked ? "1 / -1" : undefined,
              justifyContent: "flex-start",
              gap: 7,
              width: "100%",
              background: "var(--c-danger-wash)",
              border: "1px solid var(--c-danger-line)",
              color: "var(--c-danger)",
              fontSize: "var(--ui-type-caption)",
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <GoogleBrandIcon size={13} />
            {reconnectingGoogle ? "Opening Google…" : "Reconnect Google"}
          </button>
        )}
      </div>
    </div>
  );
}
