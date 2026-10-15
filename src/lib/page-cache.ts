"use client";

/**
 * The calendar's events, by the window they were loaded for, held in memory
 * so a month already seen paints at once while the refetch runs behind it.
 * Pure but for its own map, so it can be tested: `npm test -- page-cache`.
 *
 * A load notes the cache's generation before it starts and keeps its answer
 * only if the generation is the same when it lands. Every change to an event
 * moves the generation on, so a load (a prefetch of the next month, most
 * often) that set out before a save cannot put the old events back after it.
 *
 * In memory on purpose: a reload goes to the network, and nothing here
 * outlives the tab.
 */

import type { CalendarEvent } from "@/types/calendar-event";

export type EventCacheEntry = {
  events: CalendarEvent[];
  timestamp: number;
  startMs: number;
  endMs: number;
};

/** How long a window counts as fresh: shown at once and not asked for again. */
const STALE_MS = 60 * 1000;

const entries = new Map<string, EventCacheEntry>();
let generation = 0;

/** Noted by a load before it starts, and handed back to writeEventCache. */
export function cacheGeneration(): number {
  return generation;
}

export function readEventCache(key: string): EventCacheEntry | undefined {
  return entries.get(key);
}

export function isFresh(entry: EventCacheEntry | undefined, now = Date.now()): entry is EventCacheEntry {
  return Boolean(entry && now - entry.timestamp < STALE_MS);
}

/** Keeps a load's answer, unless an event changed after the load set out (`startedAt`). */
export function writeEventCache(key: string, startIso: string, endIso: string, events: CalendarEvent[], startedAt: number): boolean {
  if (startedAt !== generation) return false;
  entries.set(key, { events, timestamp: Date.now(), startMs: new Date(startIso).getTime(), endMs: new Date(endIso).getTime() });
  return true;
}

/**
 * After a change to `event`: every window it touches is dropped, and all of
 * them for a series (whose days run through every window) or for anything
 * whose times cannot be read.
 */
export function invalidateEventCache(
  event?: { start_time?: string; end_time?: string; recurrence?: CalendarEvent["recurrence"] } | null,
): void {
  generation += 1;
  const startMs = event?.start_time ? new Date(event.start_time).getTime() : NaN;
  const endMs = event?.end_time ? new Date(event.end_time).getTime() : NaN;
  if (event?.recurrence || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    entries.clear();
    return;
  }
  for (const [key, entry] of entries) {
    if (endMs >= entry.startMs && startMs <= entry.endMs) entries.delete(key);
  }
}

/** Called on sign-out (selfhost/SetupGate), so the next person to sign in starts from nothing. */
export function clearPageCache(): void {
  generation += 1;
  entries.clear();
}
