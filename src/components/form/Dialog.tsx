"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { X } from "@phosphor-icons/react";
import Modal from "@/components/Modal";
import { usePhone } from "@/lib/use-viewport-width";
import styles from "./form.module.css";
import danger from "./DangerFill.module.css";

/**
 * The card every add, edit and view dialog is drawn in.
 *
 * One width and one height for all of them, so a long description never
 * opens a card twice the size of the one before it, and every card looks
 * like the same app. The header and the buttons stay put; whatever does not
 * fit scrolls between them.
 */
export const DIALOG_MAX_WIDTH = 640;
const DIALOG_HEIGHT = "min(680px, calc(100dvh - 48px))";
const DIALOG_HEIGHT_PHONE = "calc(100dvh - 24px)";

export function DialogCard({
  label,
  heading,
  onClose,
  busy = false,
  cardClassName,
  footer,
  onKeyDown,
  closeLabel = "Close",
  maxWidth = DIALOG_MAX_WIDTH,
  fit = false,
  cardStyle,
  fadeEdges = false,
  children,
}: {
  /** The dialog's accessible name. */
  label: string;
  /** The small uppercase line at the top: "New event", "Edit task"; a way back may sit before it. */
  heading: ReactNode;
  onClose: () => void;
  /** While saving or deleting: the card cannot be closed and says it is busy. */
  busy?: boolean;
  /** The nudge a card gives when a required field is empty. */
  cardClassName?: string;
  footer?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  closeLabel?: string;
  /**
   * Only for a card whose content is not a form, such as one that listens
   * in a small card and grows to the standard width to show what it heard.
   * Every add, edit and view card keeps the standard size.
   */
  maxWidth?: number;
  /** As tall as its content, up to the standard height. */
  fit?: boolean;
  /** Extra style on the card, such as a view transition name. */
  cardStyle?: CSSProperties;
  /** Fade the body out at whichever edge has more to scroll to. */
  fadeEdges?: boolean;
  children: ReactNode;
}) {
  const phone = usePhone();
  const gutter = phone ? 18 : 28;
  const bodyRef = useRef<HTMLDivElement>(null);

  /*
   * The scroll fades: which edges have more beyond them, written straight
   * to the body as data-fade, so scrolling never renders the card. The
   * masks are in form.module.css; every picker opens in a portal, so a
   * mask here cannot hide one (CONTRIBUTING.md: a mask hides popovers).
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!fadeEdges || !body) return;
    const mark = () => {
      const above = body.scrollTop > 2;
      const below = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
      body.dataset.fade = above && below ? "both" : above ? "top" : below ? "bottom" : "none";
    };
    mark();
    body.addEventListener("scroll", mark, { passive: true });
    const observer = new ResizeObserver(mark);
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    return () => {
      body.removeEventListener("scroll", mark);
      observer.disconnect();
      delete body.dataset.fade;
    };
  }, [fadeEdges, children]);

  return (
    <Modal
      onClose={() => { if (!busy) onClose(); }}
      maxWidth={maxWidth}
      label={label}
      cardClassName={cardClassName}
      cardStyle={{
        ...(fit
          ? { height: "auto", maxHeight: phone ? DIALOG_HEIGHT_PHONE : DIALOG_HEIGHT }
          : { height: phone ? DIALOG_HEIGHT_PHONE : DIALOG_HEIGHT }),
        display: "flex",
        flexDirection: "column",
        /*
         * Clipped, not hidden: overflowY "hidden" makes overflowX "auto", and
         * a card that can scroll sideways shows a scrollbar under its
         * buttons whenever something inside it (or something a browser
         * extension puts beside a text field) runs a pixel wide. A clipped
         * card cannot be scrolled at all, by a finger or by the browser
         * bringing a caret into view. Only the body between header and
         * buttons scrolls, and only down.
         */
        overflowX: "clip",
        overflowY: "clip",
        ...cardStyle,
      }}
    >
      <div
        aria-busy={busy}
        onKeyDown={onKeyDown}
        style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: `${phone ? 12 : 18}px ${gutter}px 0`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              minWidth: 0,
              fontSize: "var(--ui-type-micro)",
              fontWeight: 600,
              color: "var(--c-text-3)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            {heading}
          </div>
          <button
            type="button"
            className={`${styles.button} ${styles.ghost} ${styles.iconButton}`}
            onClick={onClose}
            disabled={busy}
            aria-label={closeLabel}
            /* Pulled into the corner, so the X sits on the same edge as the
               fields rather than 8px inside it. */
            style={{ marginRight: -8 }}
          >
            <X size={16} />
          </button>
        </div>

        <div ref={bodyRef} className={styles.body} style={{ padding: `${phone ? 10 : 14}px ${gutter}px ${phone ? 16 : 20}px` }}>
          {children}
        </div>

        {footer && (
          <div
            style={{
              flexShrink: 0,
              padding: `${phone ? 12 : 14}px ${gutter}px`,
              borderTop: "1px solid var(--c-border-sub)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * The row of buttons at the foot of a card. What destroys sits on the left,
 * away from the rest; what leaves and what saves sit on the right, the save
 * last. Every card puts them in the same places.
 */
export function DialogFooter({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {start}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        {children}
      </div>
    </div>
  );
}

export type DialogButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function DialogButton({
  variant = "secondary",
  armed,
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: DialogButtonVariant;
  /** A danger button waiting for its second press: solid red. */
  armed?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      data-armed={armed ? "true" : undefined}
      className={`${styles.button} ${styles[variant]}${variant === "danger" && armed ? ` ${danger.fill}` : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * Delete in two presses, the same on every card: "Delete" arms it, the
 * second press says "Confirm delete" in solid red, and Keep backs out.
 */
export function DeleteAction({
  armed,
  busy,
  disabled,
  onPress,
  onKeep,
}: {
  armed: boolean;
  busy: boolean;
  disabled?: boolean;
  /** First press arms; the second, with `armed` set, deletes. */
  onPress: () => void;
  onKeep: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <DialogButton variant="danger" armed={armed} busy={busy && armed} disabled={disabled} onClick={onPress}>
        {busy && armed ? "Deleting…" : armed ? "Confirm delete" : "Delete"}
      </DialogButton>
      {armed && !busy && (
        <DialogButton variant="ghost" onClick={onKeep}>
          Keep
        </DialogButton>
      )}
    </div>
  );
}
