/**
 * Where an event dragged on the time grid lands. Pure, so it can be tested:
 * `npm test -- event-drag`.
 *
 * An event pressed and dragged moves, rather than starting a new-event
 * selection underneath it: up and down in its column in quarter hours, and
 * into another day only when the pointer has gone clearly into it, so the
 * drift of a hand moving straight down never hops it a column.
 */

/**
 * How far past a column's edge, as a share of a column, the pointer has to go
 * before the event follows it into the next day. A quarter of a column is
 * 30-odd pixels on a laptop: well past a wobble, well short of the middle.
 */
export const COLUMN_SWITCH_MARGIN = 0.25;

/** The grid's step, in minutes. */
export const DRAG_SNAP_MINUTES = 15;

const DAY_MINUTES = 24 * 60;

/**
 * The day column an event being dragged sits in.
 *
 * `pointerColumn` is the pointer's position in columns, fractional (2.5 is
 * the middle of the third). The event stays in `current` while the pointer
 * is anywhere from a margin short of its left edge to a margin past its
 * right; beyond that it moves to whichever column the pointer is over.
 */
export function dragColumn(
  current: number,
  pointerColumn: number,
  columnCount: number,
  margin = COLUMN_SWITCH_MARGIN,
): number {
  if (!Number.isFinite(pointerColumn) || columnCount <= 0) return current;
  if (pointerColumn >= current - margin && pointerColumn < current + 1 + margin) return current;
  return Math.max(0, Math.min(columnCount - 1, Math.floor(pointerColumn)));
}

/**
 * The start, in minutes after midnight, of an event being dragged: where it
 * started, moved by as far as the pointer has moved, snapped to the step and
 * kept inside the day so the whole event still fits.
 */
export function dragStartMinute(
  originStartMin: number,
  pressMin: number,
  pointerMin: number,
  durationMin: number,
  snap = DRAG_SNAP_MINUTES,
): number {
  const raw = originStartMin + (pointerMin - pressMin);
  const snapped = Math.round(raw / snap) * snap;
  const latest = Math.max(0, DAY_MINUTES - Math.max(0, durationMin));
  return Math.max(0, Math.min(latest, snapped));
}

/**
 * The event's new start and end. The length is kept exactly, to the second,
 * whatever the snap did to the start.
 */
export function movedTimes(
  day: Date,
  startMin: number,
  originalStart: Date,
  originalEnd: Date,
): { start: Date; end: Date } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(startMin);
  return { start, end: new Date(start.getTime() + (originalEnd.getTime() - originalStart.getTime())) };
}
