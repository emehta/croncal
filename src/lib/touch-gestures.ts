/**
 * What a touch means, for the places a finger does something a mouse does
 * differently: a swipe that turns a card's day, and a tap on the calendar's
 * day grid.
 *
 * Pure, so they can be tested, apart from `startsInSideScroller`, which reads
 * the page. Both fail silently: a scroll misread as a swipe flips the day
 * under someone reading, and a tap placed in the wrong slot
 * offers an event at a time nobody chose.
 */

/* A swipe is a horizontal travel this long, and clearly more across than down,
   so scrolling the card's own text never flips the day. */
export const SWIPE_MIN_PX = 50;
export const SWIPE_AXIS_RATIO = 1.5;

export type SwipeTurn = "previous" | "next";

/**
 * The day a travel of (dx, dy) turns to, or null for none.
 *
 * A finger moving left brings the next day in from the right, and moving
 * right goes back. There is no day after today, so a leftward swipe on today
 * does nothing, the same as the disabled Next arrow.
 */
export function swipeTurn(dx: number, dy: number, canGoForward: boolean): SwipeTurn | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return null;
  if (dx < 0) return canGoForward ? "next" : null;
  return "previous";
}

/*
 * Whether a touch began inside something that scrolls sideways on its own,
 * such as a strip of chips or a formula too wide for its card. Flicking that
 * is a horizontal drag across the card, and read as a swipe it would turn the
 * card instead of scrolling the strip.
 */
export function startsInSideScroller(target: HTMLElement, deck: HTMLElement): boolean {
  for (let el: HTMLElement | null = target; el && el !== deck; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
  }
  return false;
}

/** Minutes in a day, and the longest a tapped selection may start. */
const DAY_MINUTES = 24 * 60;
const TAP_SLOT_MINUTES = 30;
const TAP_SELECTION_MINUTES = 60;

/**
 * The selection a tap on an empty stretch of the day grid offers.
 *
 * A finger cannot drag out a range, since that gesture is a scroll, so a tap
 * stands for a one-hour block starting at the half hour it landed in: 9:40
 * offers 9:30 to 10:30. The last start is 23:00, so the block never runs into
 * the next day.
 */
export function tapSelection(minuteOfDay: number): { startMin: number; endMin: number } | null {
  if (!Number.isFinite(minuteOfDay)) return null;
  const snapped = Math.floor(minuteOfDay / TAP_SLOT_MINUTES) * TAP_SLOT_MINUTES;
  const startMin = Math.max(0, Math.min(DAY_MINUTES - TAP_SELECTION_MINUTES, snapped));
  return { startMin, endMin: startMin + TAP_SELECTION_MINUTES };
}
