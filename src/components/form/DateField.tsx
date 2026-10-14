"use client";

import { useRef, useState, type ReactNode } from "react";
import { CalendarBlank, CaretDown } from "@phosphor-icons/react";
import Popover from "@/components/Popover";
import { DAYS_SHORT, MONTHS_SHORT, fromDateStr } from "@/lib/date-utils";
import MonthCalendar from "./MonthCalendar";
import styles from "./form.module.css";

export interface QuickDate {
  label: string;
  /** "YYYY-MM-DD" */
  value: string;
  /** The weekday or date, quieter, on the right. */
  hint?: string;
  icon?: ReactNode;
}

/**
 * "Tue 29 Sep", with the year only when it is not this one: short enough to
 * sit whole beside a time field. The toLocaleDateString form ("Tue, 29 Sept
 * 2026") was cut off at the ellipsis in every card.
 */
export function formatFieldDate(dateStr: string): string {
  const date = fromDateStr(dateStr);
  const base = `${DAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return date.getFullYear() === new Date().getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/**
 * A date, drawn as a field that opens a month calendar. Replaces
 * `<input type="date">` on the event, goal and dream cards.
 */
export default function DateField({
  value,
  onChange,
  ariaLabel,
  placeholder = "Choose a date",
  clearable = false,
  clearLabel = "No date",
  quickDates,
  invalid,
  showIcon = true,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Offers a way back to no date at all. */
  clearable?: boolean;
  clearLabel?: string;
  /** Shortcuts above the calendar: Today, Tomorrow, Next week. */
  quickDates?: readonly QuickDate[];
  invalid?: boolean;
  showIcon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function choose(next: string | null) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.field} ${styles.trigger}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${value ? formatFieldDate(value) : placeholder}`}
        data-invalid={invalid ? "true" : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {showIcon && <CalendarBlank size={14} aria-hidden="true" />}
        <span className={`${styles.triggerValue}${value ? "" : ` ${styles.placeholder}`}`}>
          {value ? formatFieldDate(value) : placeholder}
        </span>
        <CaretDown size={13} weight="bold" className={styles.caret} aria-hidden="true" />
      </button>

      {open && (
        <Popover
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
          preferredPlacement="bottom"
          ariaLabel={ariaLabel}
          className={styles.menu}
          style={{ padding: 0 }}
        >
          {(quickDates?.length || (clearable && value)) ? (
            <div style={{ padding: "6px 6px 0", borderBottom: "1px solid var(--c-border-sub)", paddingBottom: 6 }}>
              {quickDates?.map((quick) => (
                <button
                  key={quick.label}
                  type="button"
                  className={styles.option}
                  onClick={() => choose(quick.value)}
                >
                  {quick.icon && <span style={{ display: "flex", color: "var(--c-text-4)" }}>{quick.icon}</span>}
                  {quick.label}
                  {quick.hint && (
                    <span style={{ marginLeft: "auto", color: "var(--c-text-4)", fontSize: "var(--ui-type-caption)", fontWeight: 400 }}>
                      {quick.hint}
                    </span>
                  )}
                </button>
              ))}
              {clearable && value && (
                <button type="button" className={styles.option} onClick={() => choose(null)}>
                  {clearLabel}
                </button>
              )}
            </div>
          ) : null}
          <MonthCalendar value={value} onSelect={(next) => choose(next)} />
        </Popover>
      )}
    </>
  );
}
