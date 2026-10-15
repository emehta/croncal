"use client";

/**
 * What a page had last time you were on it.
 *
 * The signed-in pages each start empty, fire their queries on mount and block
 * the whole screen until the answers land. Clicking between them therefore
 * paid the full round trip every single time, measured at 360ms to 660ms per
 * navigation against a 300ms query, and longer on a real connection.
 *
 * This holds the last answer in memory so a return visit paints immediately
 * and the refetch happens behind it. Nothing here changes what a page shows
 * once its query resolves: every page still fetches on every mount, so the
 * cache only ever decides what is on screen for the first few hundred
 * milliseconds. That is deliberate: a cache that could serve stale data as
 * final would be a correctness problem, and this one cannot.
 *
 * In memory on purpose: a reload should go to the network, and this never
 * touches storage, so nothing outlives the tab.
 */

const store = new Map<string, unknown>();

export function readPageCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function writePageCache<T>(key: string, value: T): void {
  store.set(key, value);
}

/** Called on sign-out, so the next person to sign in starts from nothing. */
export function clearPageCache(): void {
  store.clear();
}

/*
 * Keys are listed here rather than written inline at each call site, because a
 * page that reads one spelling and writes another silently loses the benefit
 * with nothing to show that it has.
 */
export const PAGE_CACHE_KEYS = {
  dashboard: "dashboard",
  tasks: "tasks",
  taskCategories: "task-categories",
  habits: "habits",
  habitLogs: "habit-logs",
  financeSummary: "finance-summary",
  income: "income",
} as const;
