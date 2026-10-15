"use client";

import { useSyncExternalStore } from "react";
import { localeFirstDay } from "@/lib/locale-defaults";

export type WeekStartPreference = "sunday" | "monday";

export type WeekRange = {
  start: Date;
  end: Date;
};

const STORAGE_KEY = "week-start";
const PREFERENCE_EVENT = "preference-change";

function isWeekStartPreference(value: string | null): value is WeekStartPreference {
  return value === "sunday" || value === "monday";
}

let localeDefault: WeekStartPreference | null = null;

/**
 * Read the current week-start preference. Until one is chosen in Settings it
 * is the first day this browser's region uses (lib/locale-defaults); the
 * server, which knows no region, says Sunday.
 */
export function getWeekStart(): WeekStartPreference {
  if (typeof window === "undefined") return "sunday";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isWeekStartPreference(stored)) return stored;
  } catch {
    // Storage blocked: the region's own first day, below.
  }
  localeDefault ??= localeFirstDay();
  return localeDefault;
}

/** Persist the preference and notify every mounted calendar/date consumer. */
export function setWeekStart(value: WeekStartPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The live preference still applies even when browser storage is blocked.
  }
  window.dispatchEvent(
    new CustomEvent(PREFERENCE_EVENT, { detail: { weekStart: value } }),
  );
}

/** Reactively consume the preference without duplicating localStorage effects. */
export function useWeekStart(): WeekStartPreference {
  return useSyncExternalStore(subscribe, getWeekStart, getServerSnapshot);
}

/** Return local-time inclusive bounds for the week containing `date`. */
export function getWeekRange(date: Date, weekStart: WeekStartPreference): WeekRange {
  const startDay = weekStart === "monday" ? 1 : 0;
  const start = new Date(date);
  const daysSinceStart = (start.getDay() - startDay + 7) % 7;
  start.setDate(start.getDate() - daysSinceStart);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Rotate a Sunday-first list to match the selected calendar convention. */
export function orderWeekdays<T>(sundayFirst: readonly T[], weekStart: WeekStartPreference): T[] {
  if (weekStart === "sunday") return [...sundayFirst];
  return [...sundayFirst.slice(1), sundayFirst[0]];
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(PREFERENCE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getServerSnapshot(): WeekStartPreference {
  return "sunday";
}
