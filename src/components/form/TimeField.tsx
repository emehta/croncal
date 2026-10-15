"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CaretDown, Clock } from "@phosphor-icons/react";
import Popover from "@/components/Popover";
import { formatTime, useTimeFormat, type TimeFormatPref } from "@/lib/time-format";
import { parseTimeInput, slotIndexFor, timeSlots } from "@/lib/time-input";
import styles from "./form.module.css";

/** "09:30" in the owner's 12h or 24h preference. */
export function formatFieldTime(value: string, format: TimeFormatPref): string {
  return formatTime(new Date(`2000-01-01T${value.slice(0, 5)}:00`), format);
}

/**
 * The day in quarter hours, with a box above it to type any time into.
 *
 * Its own component so it can sit inside a popover (TimeField) or inline in
 * another one (a date picker), where a second popover would count as a
 * click outside the first and close it.
 */
export function TimeList({
  value,
  onChoose,
  onClear,
  clearLabel = "No time",
  listHeight = 240,
  autoFocusInput = false,
}: {
  value: string | null;
  onChoose: (next: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  listHeight?: number;
  autoFocusInput?: boolean;
}) {
  const format = useTimeFormat();
  const slots = useMemo(() => timeSlots(15), []);
  const [typed, setTyped] = useState("");
  const [typedInvalid, setTypedInvalid] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  /* Opens scrolled to the current time's slot, or to 9am with none. */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const index = slotIndexFor(value, slots);
    const target = list.children[index >= 0 ? index : 36] as HTMLElement | undefined;
    if (target) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2;
  }, [value, slots]);

  function commitTyped() {
    if (!typed.trim()) return false;
    const parsed = parseTimeInput(typed);
    if (!parsed) {
      setTypedInvalid(true);
      return false;
    }
    onChoose(parsed);
    return true;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={inputId} className="sr-only">Type a time</label>
      <div className={styles.field} data-invalid={typedInvalid ? "true" : undefined} style={{ minHeight: 36, padding: "6px 10px" }}>
        <Clock size={13} aria-hidden="true" />
        <input
          id={inputId}
          autoFocus={autoFocusInput}
          value={typed}
          placeholder={format === "24h" ? "Type a time, 21:30" : "Type a time, 9:30pm"}
          onChange={(e) => { setTyped(e.target.value); setTypedInvalid(false); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            e.stopPropagation();
            commitTyped();
          }}
          onBlur={() => { if (typed.trim() && !parseTimeInput(typed)) setTypedInvalid(true); }}
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Times"
        style={{ maxHeight: listHeight, overflowY: "auto", overscrollBehavior: "contain" }}
      >
        {slots.map((slot) => (
          <button
            key={slot}
            type="button"
            role="option"
            aria-selected={value?.slice(0, 5) === slot}
            className={styles.option}
            style={{ minHeight: 32, fontVariantNumeric: "tabular-nums" }}
            onClick={() => onChoose(slot)}
          >
            {formatFieldTime(slot, format)}
          </button>
        ))}
      </div>
      {onClear && value && (
        <button type="button" className={styles.option} onClick={onClear} style={{ justifyContent: "center", color: "var(--c-text-3)" }}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}

/**
 * A time, drawn as a field that opens TimeList. Replaces `<input type="time">`,
 * whose picker is the operating system's (a spinner, a clock face, a wheel).
 */
export default function TimeField({
  value,
  onChange,
  ariaLabel,
  placeholder = "Time",
  clearable = false,
  showIcon = true,
}: {
  /** "HH:MM", or null. */
  value: string | null;
  onChange: (next: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  clearable?: boolean;
  showIcon?: boolean;
}) {
  const format = useTimeFormat();
  const [open, setOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState(200);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shown = value ? formatFieldTime(value, format) : null;

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
        aria-label={`${ariaLabel}: ${shown ?? placeholder}`}
        onClick={() => {
          setMenuWidth(Math.max(200, triggerRef.current?.offsetWidth ?? 200));
          setOpen((current) => !current);
        }}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {showIcon && <Clock size={14} aria-hidden="true" />}
        <span className={`${styles.triggerValue}${shown ? "" : ` ${styles.placeholder}`}`}>{shown ?? placeholder}</span>
        <CaretDown size={13} weight="bold" className={styles.caret} aria-hidden="true" />
      </button>

      {open && (
        <Popover
          anchorRef={triggerRef}
          onClose={() => setOpen(false)}
          preferredPlacement="bottom"
          ariaLabel={ariaLabel}
          className={styles.menu}
          style={{ width: menuWidth, padding: 6 }}
        >
          <TimeList
            value={value}
            onChoose={(next) => choose(next)}
            onClear={clearable ? () => choose(null) : undefined}
          />
        </Popover>
      )}
    </>
  );
}
