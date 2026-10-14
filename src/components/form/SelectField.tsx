"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import Popover from "@/components/Popover";
import styles from "./form.module.css";
import { contentColor } from "@/lib/content-palette";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A second, quieter line of text on the right: an offset, a count. */
  hint?: string;
  /** A dot in the option's colour. */
  color?: string;
}

/**
 * A choice from a list, drawn as a field that opens a menu.
 *
 * It replaces `<select>`, which opens the operating system's own list: a grey
 * panel on a Mac, a wheel on an iPhone, ignoring the theme on both. The time
 * zone and Repeats fields on the event card were the owner's example.
 *
 * The menu is a Popover, portalled to the body, so a card that scrolls cannot
 * clip it. Arrow keys move through the options, Enter or Space picks one,
 * Escape closes and hands focus back, and typing a letter jumps to the first
 * option that starts with it.
 */
export default function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
  placeholder = "Choose",
  disabled,
  id,
  renderValue,
  invalid,
}: {
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  icon?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Draws the chosen value in the field, if it wants more than its label. */
  renderValue?: (option: SelectOption<T>) => ReactNode;
  /** A required choice not yet made: the field's edge goes red. */
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState(240);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((option) => option.value === value) ?? null;

  function openMenu() {
    if (disabled) return;
    setMenuWidth(Math.max(200, triggerRef.current?.offsetWidth ?? 240));
    setOpen(true);
  }

  function choose(next: T) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  /* Opens on the chosen option, scrolled into view and focused. */
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')
        ?? list.querySelector<HTMLElement>('[role="option"]');
      selected?.scrollIntoView({ block: "nearest" });
      selected?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      const target = items[Math.max(0, Math.min(items.length - 1, to))];
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    };
    if (event.key === "ArrowDown") { event.preventDefault(); move(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(items.length - 1); }
    else if (event.key === "Tab") { setOpen(false); }
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const found = options.findIndex((option, i) => i > index && option.label.toLowerCase().startsWith(letter));
      const wrapped = found >= 0 ? found : options.findIndex((option) => option.label.toLowerCase().startsWith(letter));
      if (wrapped >= 0) move(wrapped);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${styles.field} ${styles.trigger}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${current?.label ?? placeholder}`}
        disabled={disabled}
        data-invalid={invalid ? "true" : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        {icon}
        {current?.color && (
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "var(--ui-radius-round)", background: contentColor(current.color), flexShrink: 0 }} />
        )}
        <span className={`${styles.triggerValue}${current ? "" : ` ${styles.placeholder}`}`}>
          {current ? (renderValue ? renderValue(current) : current.label) : placeholder}
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
          style={{ width: menuWidth, maxWidth: "calc(100vw - 24px)", maxHeight: 300, overflowY: "auto" }}
        >
          <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} onKeyDown={onListKeyDown}>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={styles.option}
                  onClick={() => choose(option.value)}
                >
                  {option.color && (
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "var(--ui-radius-round)", background: contentColor(option.color), flexShrink: 0 }} />
                  )}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                  {option.hint && (
                    <span style={{ marginLeft: "auto", paddingLeft: 12, color: "var(--c-text-4)", fontSize: "var(--ui-type-caption)", fontWeight: 400, whiteSpace: "nowrap" }}>
                      {option.hint}
                    </span>
                  )}
                  {selected && (
                    <Check size={13} weight="bold" className={styles.optionCheck} style={option.hint ? { marginLeft: 8 } : undefined} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}
