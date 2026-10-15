"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { lockDocumentScroll } from "@/lib/document-scroll";
import { GLASS_POPOVER } from "@/lib/styles";
import { usePhone } from "@/lib/use-viewport-width";

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: number;
  offsetY?: number;
  /** Accessible name for the dialog. Falls back to a generic label. */
  label?: string;
  /**
   * Class applied to the card itself, for effects that have to move the whole
   * dialog rather than its contents.
   *
   * Anything animating position here should use the `translate` property, not
   * `transform`: `offsetY` already owns `transform`, and the two compose.
   */
  cardClassName?: string;
  /**
   * The card's own style, spread after the default glass, so a caller can
   * change its surface or size and keep everything else this wrapper does.
   */
  cardStyle?: React.CSSProperties;
  /** The wash over the page behind the card. Defaults to the app's scrim. */
  scrim?: string;
}

function subscribeToNothing() {
  return () => {};
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  children,
  onClose,
  maxWidth = 480,
  offsetY = 0,
  label = "Dialog",
  cardClassName,
  cardStyle,
  scrim = "var(--c-scrim)",
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  /*
   * A phone has no room to spare around a dialog: the 24px frame would take
   * 48px off a screen already shared with the keyboard, and push the tallest
   * forms into scrolling inside a scroll.
   */
  const phone = usePhone();
  /*
   * Rendered into <body>, not where it is used.
   *
   * Safari (iPhone and Mac alike) passes a swipe over a fixed element on to
   * the scrolling element around it in the DOM. Inside <main>, the element
   * the app scrolls, a swipe on a card with nothing to scroll would move the
   * page behind it. In <body>, whose overflow the lock below holds, there is
   * nothing behind a card for a swipe to move. Mounted-gated because there
   * is no <body> on the server.
   */
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  function hasBusyAction(): boolean {
    // A busy button, or a card marked as saving, is a save or delete under way; a region that is loading is not.
    return cardRef.current?.querySelector('button[aria-busy="true"], [data-saving="true"]') !== null;
  }

  /*
   * Whether this card is the one on top. A dialog can open over another (a
   * question over the form it is about), and every open one listens to the
   * same keys: otherwise Escape would close both, throwing away the form
   * under the question, and both would hold Tab. The top one is the last
   * mounted, which is the last in <body>.
   */
  function isTopmost(): boolean {
    const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    return open[open.length - 1] === cardRef.current;
  }

  // Escape to close, and keep Tab inside the dialog: without a trap, tabbing
  // walks straight out into the page behind the backdrop.
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.defaultPrevented || !isTopmost()) return;

      if (e.key === "Escape") {
        if (!hasBusyAction()) onClose();
        return;
      }

      if (e.key !== "Tab" || !cardRef.current) return;

      const focusable = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !cardRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  // Move focus in on open and hand it back to the trigger on close.
  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    /*
     * A dialog can nominate the control it wants focused with data-autofocus.
     *
     * Without one this takes querySelector(FOCUSABLE), which returns the
     * first match in *document order*: in any dialog with a header, the close
     * button, whatever the selector lists first. A field's own autoFocus is
     * overridden a tick later by this effect, and React does not render an
     * `autofocus` attribute, so there is nothing to match on unless the
     * dialog says so explicitly.
     */
    const target = card?.querySelector<HTMLElement>("[data-autofocus]")
      ?? card?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? card)?.focus();

    return () => {
      // Not when a card opened since has taken focus: it keeps it.
      const now = document.activeElement;
      if (now && now !== document.body && !card?.contains(now)) return;
      previouslyFocused?.focus?.();
    };
  }, [mounted]);

  // Body scroll lock, keeping the scrollbar's room so a page behind the card
  // does not shift sideways (lib/document-scroll).
  useEffect(() => lockDocumentScroll(), []);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        /* The page never scrolls under a card, whatever the browser. */
        overscrollBehavior: "contain",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: scrim,
        backdropFilter: "blur(8px)",
        padding: phone ? "12px 10px" : "24px 16px",
      }}
      onMouseDown={(e) => {
        /* The second press of a double click that opened this card lands on
           its scrim, and must not close it again at once. */
        if (e.detail > 1) return;
        if (cardRef.current && !cardRef.current.contains(e.target as Node) && !hasBusyAction()) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cardClassName}
        style={{
          position: "relative",
          width: "100%",
          maxWidth,
          // dvh so mobile browser chrome doesn't clip the card.
          maxHeight: phone ? "calc(100dvh - 24px)" : "calc(100dvh - 48px)",
          overflowY: "auto",
          // A dialog scrolled to its end must not start scrolling the page
          // behind it, which on a phone is the next thing the thumb moves.
          overscrollBehavior: "contain",
          ...GLASS_POPOVER,
          borderRadius: "var(--ui-radius-xl)",
          /*
           * The card takes focus itself when nothing inside it holds it: on
           * open with no field to land on, or when you click its background
           * after a picker has closed. It is a container, not a control, so it
           * draws no ring. Without this Chrome paints its own blue one round
           * the whole card on the next keypress.
           */
          outline: "none",
          transform: offsetY ? `translateY(${offsetY}px)` : undefined,
          ...cardStyle,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
