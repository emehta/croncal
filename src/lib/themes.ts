/**
 * The signed-in app's themes: their names, and which of them are light.
 *
 * Its own module, with no "use client", so the root layout can read it too:
 * the pre-paint script there cannot import a module at run time, but the
 * layout can write this list into the script as it renders. A copy of the
 * names kept there by hand would learn about a new theme an update later than
 * everything else.
 *
 * The order is the order Settings' row runs in, so it has to read as one
 * line: the two bases first (Midnight, Light), then their alternates in the
 * same dark-then-light order (Onyx the black Midnight, Paper the warm Light),
 * then the coloured themes round the rainbow (Oxblood red, Warm amber, Nature
 * green, Indigo blue, Dusk violet), not grouped by family.
 *
 * Midnight is the absence of `data-theme`, and lives in `:root`; every other
 * theme is a `[data-theme=…]` block in globals.css.
 */

export const THEME_VALUES = [
  "midnight", "light",
  "onyx", "paper",
  "oxblood", "warm", "nature", "indigo", "dusk",
] as const;

export type ThemeValue = (typeof THEME_VALUES)[number];

export const THEME_LABELS: Readonly<Record<ThemeValue, string>> = {
  midnight: "Midnight",
  onyx: "Onyx",
  light: "Light",
  indigo: "Indigo",
  dusk: "Dusk",
  oxblood: "Oxblood",
  warm: "Warm",
  nature: "Nature",
  paper: "Paper",
};

/**
 * The themes drawn on a light ground. Every rule in the app written for a
 * light ground (`[data-theme="light"]` in globals.css and the component
 * modules) names Paper beside Light, and this is what `color-scheme` follows.
 */
export const LIGHT_THEMES: readonly ThemeValue[] = ["light", "paper"];

export function isThemeValue(value: unknown): value is ThemeValue {
  return typeof value === "string" && (THEME_VALUES as readonly string[]).includes(value);
}
