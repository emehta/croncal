"use client";

import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * A panel anchored to a control, portalled to the body.
 *
 * Owns the four things every anchored panel in this app needs: measuring
 * itself against the viewport and flipping placement when it will not fit,
 * closing on an outside click, closing on Escape before an enclosing modal
 * sees the keypress, and re-measuring on scroll and resize because it is
 * `position: fixed` over a page that moves. The date, time and select
 * pickers are all this.
 */

type Placement = "top" | "bottom";
type Align = "left" | "right";

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  preferredPlacement?: Placement;
  align?: Align;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const PANEL_FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Popover({
  anchorRef,
  onClose,
  preferredPlacement = "top",
  align = "left",
  children,
  className,
  style,
  ariaLabel = "Options",
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  /* Whether the panel is held to the window's height (below). */
  const heldRef = useRef(false);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  /* A panel's own height limit, which it keeps unless the window is shorter. */
  const ownMaxHeight = style?.maxHeight;
  const ownOverflowY = style?.overflowY;
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number | null; ready: boolean }>(
    { top: 0, left: 0, maxHeight: null, ready: false },
  );

  useLayoutEffect(() => {
    if (!mounted || !anchorRef.current || !panelRef.current) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const gap = 8;
      const viewportPadding = 12;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      /*
       * Never taller than the window. A date picker with its times is 620px,
       * and in the 548px Safari leaves on an iPhone SE the clamp below alone
       * would put its top above the screen, out of reach, on a panel that
       * could not scroll. A panel that does not fit is held to the window and
       * scrolls inside itself; one that fits is measured and placed as is.
       *
       * A panel already held is measured with the hold taken off for the
       * moment (its own limit, if it has one, put back), so it lets go once
       * the window is tall enough again, a phone turned upright, and a list
       * that scrolls within its own 300px is never mistaken for one taller.
       */
      const available = viewportHeight - viewportPadding * 2;
      let naturalHeight = panelRect.height;
      if (heldRef.current) {
        const held = { maxHeight: panel.style.maxHeight, overflowY: panel.style.overflowY };
        panel.style.maxHeight = typeof ownMaxHeight === "number" ? `${ownMaxHeight}px` : ownMaxHeight ?? "";
        panel.style.overflowY = ownOverflowY ?? "";
        naturalHeight = panel.getBoundingClientRect().height;
        panel.style.maxHeight = held.maxHeight;
        panel.style.overflowY = held.overflowY;
      }
      const maxHeight = naturalHeight > available ? available : null;
      heldRef.current = maxHeight !== null;
      const height = maxHeight ?? naturalHeight;

      const topAbove = anchorRect.top - height - gap;
      const topBelow = anchorRect.bottom + gap;
      const fitsAbove = topAbove >= viewportPadding;
      const fitsBelow = topBelow + height <= viewportHeight - viewportPadding;

      let top = preferredPlacement === "top" ? topAbove : topBelow;
      if (preferredPlacement === "top") {
        top = fitsAbove || !fitsBelow ? topAbove : topBelow;
      } else {
        top = fitsBelow || !fitsAbove ? topBelow : topAbove;
      }

      let left = align === "right" ? anchorRect.right - panelRect.width : anchorRect.left;
      left = clamp(left, viewportPadding, viewportWidth - panelRect.width - viewportPadding);
      top = clamp(top, viewportPadding, viewportHeight - height - viewportPadding);

      setPosition((current) => {
        if (current.top === top && current.left === left && current.maxHeight === maxHeight && current.ready) {
          return current;
        }
        return { top, left, maxHeight, ready: true };
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [mounted, anchorRef, preferredPlacement, align, children, ownMaxHeight, ownOverflowY]);

  /*
   * Closes on a press anywhere but the panel and its anchor, and when focus
   * moves anywhere else, which is how a keyboard leaves it.
   *
   * Both in the capture phase. Every dialog card stops mousedown on its way
   * up (Modal), so that a press inside a picker portalled out of the card is
   * not taken for a press on the backdrop. Heard in the bubble phase, a press
   * inside a card would never reach this, and opening a second picker on a
   * card would leave the first open. Capture hears it before anything can
   * stop it. Focus covers Tab: from a picker's field to the next one and open
   * it, and the first closes.
   */
  useEffect(() => {
    if (!mounted) return;

    function isOutside(target: EventTarget | null) {
      if (!(target instanceof Node)) return false;
      return !panelRef.current?.contains(target) && !anchorRef.current?.contains(target);
    }

    function handlePress(event: MouseEvent) {
      if (isOutside(event.target)) onClose();
    }

    function handleFocus(event: FocusEvent) {
      if (isOutside(event.target)) onClose();
    }

    document.addEventListener("mousedown", handlePress, true);
    document.addEventListener("focusin", handleFocus, true);
    return () => {
      document.removeEventListener("mousedown", handlePress, true);
      document.removeEventListener("focusin", handleFocus, true);
    };
  }, [mounted, anchorRef, onClose]);

  useEffect(() => {
    if (!mounted) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
      anchorRef.current?.focus();
    }

    // Capture Escape before an enclosing modal sees it. Otherwise one keypress
    // closes both this top-most popover and the dialog underneath it.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [mounted, anchorRef, onClose]);

  /*
   * Keyboard reach. The panel is portalled to <body>, outside any dialog it
   * opens from, so with focus left on the anchor a picker opened with Enter
   * could not be tabbed into: Tab walks on from the chip, and a dialog's
   * focus trap never looks outside its own card.
   *
   * Opened from the keyboard (the anchor is showing its focus ring), focus
   * moves to the panel's first control. Opened by mouse, nothing moves.
   * While focus is inside the panel, Tab cycles within it and never escapes
   * to the page behind a dialog; Escape above still hands focus back to the
   * anchor.
   */
  useEffect(() => {
    if (!mounted || !position.ready) return;
    const panel = panelRef.current;
    if (!panel || !anchorRef.current?.matches(":focus-visible")) return;
    panel.querySelector<HTMLElement>(PANEL_FOCUSABLE)?.focus({ preventScroll: true });
    // Only on opening: re-running on every reposition would pull focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, position.ready]);

  useEffect(() => {
    if (!mounted) return;
    function handleTab(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel || !panel.contains(document.activeElement)) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE))
        .filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      /* Every step handled here, not just the wrap: the dialog underneath
         traps Tab too, and on Shift+Tab from outside its card it would pull
         focus back to its own last control. */
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      items[(index + step + items.length) % items.length].focus();
    }
    document.addEventListener("keydown", handleTab, true);
    return () => document.removeEventListener("keydown", handleTab, true);
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="group"
      aria-label={ariaLabel}
      className={className}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 1000,
        visibility: position.ready ? "visible" : "hidden",
        ...style,
        ...(position.maxHeight !== null
          ? { maxHeight: position.maxHeight, overflowY: "auto", overscrollBehavior: "contain" }
          : null),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
