"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * A small themed label that appears the moment you point at something.
 *
 * Replaces the native `title` attribute, which renders as the operating
 * system's own grey box after roughly a second: unthemed, unstyleable, and
 * slow enough that you have usually clicked before it arrives.
 *
 * No open delay at all, by request. The usual argument for one is that
 * sweeping a cursor across a row of buttons pops a bubble over each in turn;
 * the answer here is that the bubble is small, appears where the cursor
 * already is, and vanishes the instant the cursor leaves or presses.
 *
 * Positioning happens in a layout effect, so the bubble is measured and placed
 * before the browser paints. It never flashes at the wrong spot on the way to
 * the right one, which is what "instant" would otherwise cost.
 *
 * It wraps its trigger rather than cloning it, so nothing has to forward a ref
 * and any element can be a trigger.
 *
 * Deliberately aria-hidden. Every trigger that uses this already carries an
 * aria-label naming it, and a tooltip repeating that would have a screen
 * reader say the same thing twice. This is visual reinforcement for people
 * using a mouse, which is exactly who the native tooltip served.
 */

const EDGE_PADDING = 8;
const GAP = 6;

type Placement = "top" | "bottom";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function Tooltip({
  label,
  placement = "top",
  children,
}: {
  /**
   * A string for the usual one-line label, or a node for a richer bubble.
   *
   * A plain string keeps the original behaviour exactly: one line, no wrap. A
   * node is allowed to wrap and to change size while it is open — the market
   * ribbon's bubble counts down to the opening bell — which is what the
   * observer below exists for.
   */
  label: React.ReactNode;
  placement?: Placement;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const simple = typeof label === "string";

  const close = useCallback(() => {
    setOpen(false);
    setPosition((current) => ({ ...current, ready: false }));
  }, []);

  // Escape closes it, and so does anything that scrolls it away from its anchor.
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    /**
     * Only a scroll that can actually move the anchor.
     *
     * The listener has to be on the capture phase, because a scroll event does
     * not bubble and a tooltip inside a scrolling panel still has to close. But
     * capturing at the window means catching every scroll in the document,
     * including from elements that have nothing to do with this anchor — and
     * the dashboard has one that scrolls *itself* on every animation frame.
     *
     * The market ribbon's rail is a marquee driven by writing `scrollLeft` from
     * requestAnimationFrame, roughly 120 events a second. The portfolio pill
     * sits beside it, not inside it, so its tooltip could never move — and it
     * was being closed within a frame of opening, every time. Measured: the
     * bubble survived 0 ms with the rail running and 1555 ms with it stopped.
     *
     * Containment is the whole test. A scrolling ancestor carries the anchor
     * with it, so the bubble must go; the page itself counts, because
     * `document.contains` is true for anything attached. A sibling scrolling
     * its own contents moves nothing.
     */
    function onScroll(event: Event) {
      const anchor = anchorRef.current;
      const target = event.target;
      if (!anchor || !(target instanceof Node) || target.contains(anchor)) close();
    }

    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  /*
   * Measured and placed before paint, and re-measured whenever the bubble
   * changes size.
   *
   * `label` is deliberately not a dependency. A node prop is a new object on
   * every render of the parent, so depending on it would re-run this effect,
   * which sets state, which renders again — a loop. A ResizeObserver covers
   * the case that actually matters instead: content that grows or shrinks
   * while the bubble is open, which a live countdown does.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      if (!anchorRef.current || !bubbleRef.current) return;

      const anchor = anchorRef.current.getBoundingClientRect();
      const bubble = bubbleRef.current.getBoundingClientRect();

      const above = anchor.top - bubble.height - GAP;
      const below = anchor.bottom + GAP;
      const fitsAbove = above >= EDGE_PADDING;
      const fitsBelow = below + bubble.height <= window.innerHeight - EDGE_PADDING;

      const top = placement === "top"
        ? (fitsAbove || !fitsBelow ? above : below)
        : (fitsBelow || !fitsAbove ? below : above);

      const left = clamp(
        anchor.left + anchor.width / 2 - bubble.width / 2,
        EDGE_PADDING,
        window.innerWidth - bubble.width - EDGE_PADDING,
      );

      // Bail when nothing moved, so the observer cannot feed itself.
      setPosition((current) => (
        current.ready && current.top === top && current.left === left
          ? current
          : { top, left, ready: true }
      ));
    };

    place();
    const bubble = bubbleRef.current;
    if (!bubble) return;

    const observer = new ResizeObserver(place);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [open, placement]);

  return (
    <>
      <span
        ref={anchorRef}
        /* Hugs its child and never shrinks: a trigger is an icon button with a
           fixed width, and a flex parent would otherwise squeeze this wrapper
           and clip the button inside it. */
        style={{ display: "inline-flex", flexShrink: 0 }}
        /* Mouse only. A touch screen has no hover, so a tooltip there would
           flash on tap and cover the thing you just pressed. */
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
        onPointerLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
        /* Once you have clicked you know what it does, and the bubble would
           otherwise sit over whatever the click just opened. */
        onPointerDown={close}
      >
        {children}
      </span>

      {mounted && open && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          aria-hidden="true"
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            zIndex: 1100,
            visibility: position.ready ? "visible" : "hidden",
            padding: simple ? "4px 8px" : "7px 9px",
            maxWidth: 260,
            background: "var(--page-bg)",
            border: "1px solid var(--c-border)",
            borderRadius: "var(--ui-radius-tooltip)",
            boxShadow: "var(--shadow-pop)",
            color: "var(--c-text-1)",
            fontSize: "var(--ui-type-caption)",
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: simple ? "nowrap" : "normal",
            pointerEvents: "none",
          }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
