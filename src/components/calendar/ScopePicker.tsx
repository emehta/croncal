"use client";

import { useRef, type KeyboardEvent } from "react";
import Modal from "@/components/Modal";
import StatusBanner from "@/components/StatusBanner";
import { DialogButton } from "@/components/form/Dialog";
import type { RecurrenceEditScope } from "@/types/calendar-event";
import { SCOPE_LABELS } from "@/lib/series-edit";
import styles from "./ScopePicker.module.css";

/**
 * Which days of a repeating event a change is for, asked once the change is
 * made: after Save, a drop or Delete. A choice and then Confirm, as Google
 * Calendar asks it, with nothing under the title or the options. It used to
 * come before the form, with a paragraph and a line under every option, and
 * a press on an option was the decision itself (the owner, 5 Oct 2026).
 *
 * It opens over the event form, and Cancel or Escape closes only this, so
 * the changes in the form are still there.
 */
export default function ScopePicker({
  title,
  options,
  value,
  onChange,
  onConfirm,
  onCancel,
  busy,
  error,
  onDismissError,
}: {
  title: string;
  options: readonly RecurrenceEditScope[];
  value: RecurrenceEditScope;
  onChange: (next: RecurrenceEditScope) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string;
  onDismissError: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /* Arrow keys move the choice, as in any radio group; Enter confirms it. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!busy) onConfirm();
      return;
    }
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1
        : 0;
    if (!step || busy) return;
    event.preventDefault();
    const index = (options.indexOf(value) + step + options.length) % options.length;
    onChange(options[index]);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
  }

  return (
    <Modal onClose={() => { if (!busy) onCancel(); }} maxWidth={380} label={title}>
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontSize: "var(--ui-type-title-sm)", fontWeight: 600, color: "var(--c-text-1)" }}>
          {title}
        </h2>

        <div ref={listRef} role="radiogroup" aria-label={title} className={styles.options} onKeyDown={onKeyDown}>
          {options.map((option) => {
            const checked = option === value;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                data-autofocus={checked ? true : undefined}
                disabled={busy}
                className={styles.option}
                onClick={() => onChange(option)}
              >
                <span className={styles.dot} aria-hidden="true" />
                {SCOPE_LABELS[option]}
              </button>
            );
          })}
        </div>

        {error && <StatusBanner message={error} onDismiss={onDismissError} />}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <DialogButton variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </DialogButton>
          <DialogButton variant="primary" onClick={onConfirm} busy={busy} disabled={busy}>
            {busy ? "Saving…" : "Confirm"}
          </DialogButton>
        </div>
      </div>
    </Modal>
  );
}
