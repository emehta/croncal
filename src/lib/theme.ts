"use client";

/**
 * The themes, and the two lines that switch between them.
 *
 * Lifted out of `Sidebar.tsx` when universal search gained "switch to Light
 * theme" as a command. A second copy of `applyTheme` is exactly the
 * duplication that let the dashboard and the task pages disagree about
 * priority colours: both copies work, and then one of them learns about a
 * fifth theme and the other does not.
 *
 * The names themselves live in `lib/themes.ts`, which has no "use client" so
 * the root layout can write them into its pre-paint script, the third reader
 * of `vitae-theme`.
 */

import { isThemeValue, type ThemeValue } from "@/lib/themes";

export type { ThemeValue } from "@/lib/themes";

export const THEME_STORAGE_KEY = "vitae-theme";

/** The saved theme, or Midnight for anything unreadable or unrecognised. */
export function readStoredTheme(): ThemeValue {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeValue(saved) ? saved : "midnight";
  } catch {
    return "midnight";
  }
}

/**
 * Paint a theme.
 *
 * Midnight is the absence of the attribute rather than a value of it, which
 * is what lets `globals.css` hold it in `:root` as the default and every
 * other theme in a `[data-theme=…]` block.
 */
export function applyTheme(theme: ThemeValue): void {
  if (theme === "midnight") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

/**
 * Choose a theme: persist it, paint it, and tell the rest of the tab.
 *
 * `storage` only fires in *other* tabs, so a switch made from search would
 * leave the sidebar's own radio group showing the previous theme until
 * something else re-rendered it. The same `vitae-preference` event the week
 * start and time format already use covers this tab.
 */
export function setTheme(theme: ThemeValue): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Apply the current choice even if the browser blocks persistence.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event("vitae-preference"));
}
