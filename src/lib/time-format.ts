/**
 * Global time formatting utilities.
 *
 * Reads user preference from localStorage ("time-format": "12h" | "24h").
 * Provides pure functions and a React hook for reactive updates.
 *
 * Until one is chosen in Settings, the clock is the one this browser's
 * language and region use (lib/locale-defaults). The server, which knows
 * neither, says 24h.
 */

import { useSyncExternalStore } from "react";
import { formatClock } from "@/lib/clock-format";
import type { TimeFormatPref } from "@/lib/clock-format";
import { localeClock } from "@/lib/locale-defaults";

export type { TimeFormatPref } from "@/lib/clock-format";

let localeDefault: TimeFormatPref | null = null;

/** Read current preference (safe for SSR, where it is 24h). */
export function getTimeFormat(): TimeFormatPref {
  if (typeof window === "undefined") return "24h";
  try {
    const stored = localStorage.getItem("time-format");
    if (stored === "12h" || stored === "24h") return stored;
  } catch {
    // Storage blocked: the locale's own clock, below.
  }
  localeDefault ??= localeClock();
  return localeDefault;
}

/** Persist the choice from Settings and tell every mounted clock. */
export function setTimeFormat(value: TimeFormatPref): void {
  try {
    localStorage.setItem("time-format", value);
  } catch {
    // The event below still updates every mounted consumer for this session.
  }
  window.dispatchEvent(new CustomEvent("preference-change", { detail: { timeFormat: value } }));
}

/** React hook: re-renders when the user changes the preference in Settings. */
export function useTimeFormat(): TimeFormatPref {
  return useSyncExternalStore(subscribe, getTimeFormat, getServerSnapshot);
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("preference-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("preference-change", callback);
    window.removeEventListener("storage", callback);
  };
}

function getServerSnapshot(): TimeFormatPref {
  return "24h";
}

/** Format a Date's time portion (e.g. "3:42 PM" or "15:42"). */
export function formatTime(date: Date, format?: TimeFormatPref): string {
  return formatClock(date, format ?? getTimeFormat());
}

/** Format an hour number (0-23) as a label (e.g. "3 PM" or "15:00"). */
export function formatHour(hour: number, format?: TimeFormatPref): string {
  const is24 = (format ?? getTimeFormat()) === "24h";
  if (is24) return `${String(hour).padStart(2, "0")}:00`;
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** Format a time range from two Dates (e.g. "3:00 PM – 4:30 PM"). */
export function formatTimeRange(start: Date, end: Date, format?: TimeFormatPref): string {
  return `${formatTime(start, format)} to ${formatTime(end, format)}`;
}
