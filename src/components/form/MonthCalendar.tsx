"use client";

import { useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { MONTH_NAMES, fromDateStr, toDateStr } from "@/lib/date-utils";
import { orderWeekdays, useWeekStart, type WeekStartPreference } from "@/lib/week-start";
import styles from "./form.module.css";

export function getCalendarDays(year: number, month: number, weekStart: WeekStartPreference) {
  const firstDow = new Date(year, month, 1).getDay();
  const preferredStart = weekStart === "monday" ? 1 : 0;
  const startOffset = (firstDow - preferredStart + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const days: { date: Date; current: boolean }[] = [];
  for (let i = startOffset - 1; i >= 0; i--) days.push({ date: new Date(year, month - 1, daysInPrev - i), current: false });
  for (let i = 1; i <= daysInMonth; i++) days.push({ date: new Date(year, month, i), current: true });
  let next = 1;
  while (days.length % 7 !== 0) days.push({ date: new Date(year, month + 1, next++), current: false });
  return days;
}

const WEEKDAYS = [
  { short: "S", full: "Sunday" },
  { short: "M", full: "Monday" },
  { short: "T", full: "Tuesday" },
  { short: "W", full: "Wednesday" },
  { short: "T", full: "Thursday" },
  { short: "F", full: "Friday" },
  { short: "S", full: "Saturday" },
];

/**
 * A month of days to pick from, in the week order the owner set. The same
 * grid in every date field and date picker; it replaces the browser's
 * `<input type="date">`, whose calendar is drawn by the operating system and
 * ignores the theme.
 */
export default function MonthCalendar({
  value,
  onSelect,
}: {
  /** "YYYY-MM-DD", or null. The month shown first is this one's, else today's. */
  value: string | null;
  onSelect: (dateStr: string) => void;
}) {
  const weekStart = useWeekStart();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = value ? fromDateStr(value) : today;
  const [viewYear, setViewYear] = useState(start.getFullYear());
  const [viewMonth, setViewMonth] = useState(start.getMonth());

  function shift(by: number) {
    const next = new Date(viewYear, viewMonth + by, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  const todayKey = toDateStr(today);
  const days = getCalendarDays(viewYear, viewMonth, weekStart);

  return (
    <div className={styles.calendar}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <button type="button" className={styles.navButton} onClick={() => shift(-1)} aria-label="Previous month">
          <CaretLeft size={14} />
        </button>
        <span style={{ fontSize: "var(--ui-type-body-sm)", fontWeight: 600, color: "var(--c-text-1)" }}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button type="button" className={styles.navButton} onClick={() => shift(1)} aria-label="Next month">
          <CaretRight size={14} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
        {orderWeekdays(WEEKDAYS, weekStart).map((day) => (
          <div
            key={day.full}
            aria-label={day.full}
            style={{ textAlign: "center", fontSize: "var(--ui-type-caption)", color: "var(--c-text-4)", padding: "4px 0" }}
          >
            {day.short}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {days.map(({ date, current }) => {
          const key = toDateStr(date);
          const classes = [styles.day];
          if (!current) classes.push(styles.dayOutside);
          if (key === todayKey) classes.push(styles.dayToday);
          return (
            <button
              key={key}
              type="button"
              className={classes.join(" ")}
              aria-pressed={key === value}
              aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              onClick={() => onSelect(key)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
