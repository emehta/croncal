"use client";

/**
 * What a connection looked like last time, so a tile opens on the answer.
 *
 * The Google check is a network round trip, and seeded `false` while it ran
 * the calendar first drew as disconnected, then connected a moment later,
 * every time: "no" is a real state here rather than a neutral one.
 *
 * These states change on the order of once a year, so the last answer is
 * almost always the right one. It is still only a first frame: the live check
 * runs whenever the state is shown and overwrites it, so a stale value costs
 * one frame and can never persist. The calendar reads it too, so its first
 * fetch can ask Google straight away rather than after the check.
 *
 * The same trick the app already plays with the theme before first paint, and
 * with `page-cache` between navigations.
 */
const CONNECTION_MEMORY_PREFIX = "connected:";

export function rememberedConnection(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONNECTION_MEMORY_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export function rememberConnection(key: string, connected: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONNECTION_MEMORY_PREFIX + key, connected ? "1" : "0");
  } catch {
    // A tile that flashes once is not worth failing over.
  }
}
