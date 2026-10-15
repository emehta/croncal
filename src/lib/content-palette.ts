/**
 * Each theme's content colours.
 *
 * A content colour is a fixed hue that belongs to the thing rather than the
 * theme: a Google event's colour, a goal's. Painted as stored on every theme,
 * they would make each one the same app on a new background, so a theme may
 * carry its own version of each, drawn from its own named hues, with the
 * meaning kept (a red event is still red, a yellow one still yellow).
 *
 * The stored colour never changes. It is translated where it is painted:
 * `contentColor` turns it into `var(--pal-<hex>, <hex>)`, and the root layout
 * writes `contentPaletteCss()` into the page head, so a theme with a palette
 * sets those variables and every other theme falls through to the colour as
 * stored. Anything that reads a colour's value (the event form's swatches,
 * Google's colorId, luminance) keeps the stored hex; a mark drawn on a
 * content colour takes `contentInk`, worked out here from the theme's own hue.
 *
 * Pure, and tested: `npm test -- content-palette`.
 */

import { contrastRatio, luminance, readableOn } from "@/lib/readable-on";
import { THEME_VALUES, type ThemeValue } from "@/lib/themes";

/**
 * Every content colour a palette covers, lower case, by where it comes from:
 * Google's eleven event colours and its default (CronCal's
 * lib/google-calendar) and the goal palette (Todoer's types/category). A
 * colour in both lists is one entry in a palette.
 */
export const CONTENT_SOURCES = {
  google: ["#7986cb", "#33b679", "#8e24aa", "#e67c73", "#f6bf26", "#f4511e", "#039be5", "#616161", "#3f51b5", "#0b8043", "#d50000", "#4285f4"],
  goal: ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#808080"],
} as const;

export type ContentPalette = Readonly<Record<string, string>>;

/** The themes that carry one. A theme absent here paints colours as stored. */
export const CONTENT_PALETTES: Readonly<Partial<Record<ThemeValue, ContentPalette>>> = {
  onyx: {
    // google
    "#7986cb": "#9796db",
    "#33b679": "#64c7a1",
    "#8e24aa": "#a658ca",
    "#e67c73": "#e58b88",
    "#f6bf26": "#f0c630",
    "#f4511e": "#eb6528",
    "#039be5": "#4eace3",
    "#616161": "#818387",
    "#3f51b5": "#4f62c1",
    "#0b8043": "#00aa6f",
    "#d50000": "#dc3d4d",
    "#4285f4": "#467be1",
    // goal
    "#ef4444": "#dc3d4d",
    "#f97316": "#eb6528",
    "#f59e0b": "#f2a036",
    "#eab308": "#f0c630",
    "#84cc16": "#a0d157",
    "#22c55e": "#00aa6f",
    "#14b8a6": "#15b6a9",
    "#06b6d4": "#66cfe1",
    "#3b82f6": "#467be1",
    "#6366f1": "#8a70dd",
    "#8b5cf6": "#9f6bd9",
    "#ec4899": "#e36199",
    "#808080": "#818387",
  },
  indigo: {
    // google
    "#7986cb": "#98a6c8",
    "#33b679": "#8fbb37",
    "#8e24aa": "#ad72c5",
    "#e67c73": "#f2795a",
    "#f6bf26": "#f5a000",
    "#f4511e": "#ff6400",
    "#039be5": "#5db2bd",
    "#616161": "#6c7d7e",
    "#3f51b5": "#4466a7",
    "#0b8043": "#64920e",
    "#d50000": "#ff3b07",
    "#4285f4": "#7e9cd8",
    // goal
    "#ef4444": "#ff5d62",
    "#f97316": "#ffa066",
    "#f59e0b": "#ff9e3b",
    "#eab308": "#e6c384",
    "#84cc16": "#98bb6c",
    "#22c55e": "#76946a",
    "#14b8a6": "#7aa89f",
    "#06b6d4": "#a3d4d5",
    "#3b82f6": "#7e9cd8",
    "#6366f1": "#9cabca",
    "#8b5cf6": "#957fb8",
    "#ec4899": "#d27e99",
    "#808080": "#717c7c",
  },
  dusk: {
    // google
    "#7986cb": "#9aaae0",
    "#33b679": "#6cc93b",
    "#8e24aa": "#c597f8",
    "#e67c73": "#fb9069",
    "#f6bf26": "#eea700",
    "#f4511e": "#fd6b0c",
    "#039be5": "#2dbfc7",
    "#616161": "#908caa",
    "#3f51b5": "#536fc1",
    "#0b8043": "#3a9100",
    "#d50000": "#ff451c",
    "#4285f4": "#2d8fb4",
    // goal
    "#ef4444": "#f06b6c",
    "#f97316": "#f59b62",
    "#f59e0b": "#ebae42",
    "#eab308": "#f6c177",
    "#84cc16": "#c7d97b",
    "#22c55e": "#8fd4a1",
    "#14b8a6": "#6dc3b8",
    "#06b6d4": "#9ccfd8",
    "#3b82f6": "#3e8fb0",
    "#6366f1": "#a2b2e8",
    "#8b5cf6": "#c4a7e7",
    "#ec4899": "#eb6f92",
    "#808080": "#908caa",
  },
  oxblood: {
    // google
    "#7986cb": "#6f88de",
    "#33b679": "#09c688",
    "#8e24aa": "#8e58cf",
    "#e67c73": "#f06c5a",
    "#f6bf26": "#c9a602",
    "#f4511e": "#ec7903",
    "#039be5": "#11a0d7",
    "#616161": "#817670",
    "#3f51b5": "#446bd7",
    "#0b8043": "#03af69",
    "#d50000": "#f0230d",
    "#4285f4": "#168ee0",
    // goal
    "#ef4444": "#fd4339",
    "#f97316": "#e88701",
    "#f59e0b": "#d49a0c",
    "#eab308": "#c09f03",
    "#84cc16": "#7fb123",
    "#22c55e": "#1ac86d",
    "#14b8a6": "#0db9aa",
    "#06b6d4": "#26b9cd",
    "#3b82f6": "#118ee2",
    "#6366f1": "#6275f6",
    "#8b5cf6": "#8765e5",
    "#ec4899": "#ee649f",
    "#808080": "#9b908a",
  },
  paper: {
    // google
    "#7986cb": "#777db9",
    "#33b679": "#6c9f84",
    "#8e24aa": "#76408d",
    "#e67c73": "#c76c74",
    "#f6bf26": "#d6a400",
    "#f4511e": "#c8541f",
    "#039be5": "#1b80b0",
    "#616161": "#6c655d",
    "#3f51b5": "#3a4aa0",
    "#0b8043": "#377337",
    "#d50000": "#a8272d",
    "#4285f4": "#2a66b6",
    // goal
    "#ef4444": "#b03a2e",
    "#f97316": "#c35f26",
    "#f59e0b": "#b98322",
    "#eab308": "#c99c18",
    "#84cc16": "#7c9330",
    "#22c55e": "#4a8644",
    "#14b8a6": "#2f8479",
    "#06b6d4": "#2f86a3",
    "#3b82f6": "#3568a8",
    "#6366f1": "#4b5398",
    "#8b5cf6": "#7253a6",
    "#ec4899": "#b24b73",
    "#808080": "#7a7268",
  },
};

/** "#rrggbb" in any case, as the six lower-case digits; null for anything else. */
function paletteKey(color: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  return match ? match[1].toLowerCase() : null;
}

/** A content colour as the current theme paints it. Anything not a hex is returned as given. */
export function contentColor(color: string): string {
  const key = paletteKey(color);
  return key ? `var(--pal-${key}, ${color})` : color;
}

/**
 * The ink for a mark or a title drawn on a content colour, as the current
 * theme paints it: a selected event's title on its solid fill.
 * Only those (`INKED`) have one set per theme; any other falls back to the
 * ink for the colour as stored.
 */
export function contentInk(color: string): string {
  const key = paletteKey(color);
  return key ? `var(--pal-ink-${key}, ${readableOn(color)})` : readableOn(color);
}

/**
 * A content colour as a solid fill a title can sit on: the colour itself when
 * its ink already reads on it at 4.5:1, else nudged towards black (under a
 * white ink) or white (under a dark one) a step at a time until it does. A
 * mid-tone can miss with either ink (Onyx's amethyst was 4.3:1), and a step
 * of a few percent is not a different colour.
 */
export function legibleFill(hex: string): string {
  const base = luminance(hex);
  if (base === null) return hex;
  const ink = readableOn(hex);
  const inkLuminance = luminance(ink)!;
  const towards = ink === "#ffffff" ? 0 : 255;
  const n = parseInt(hex.trim().slice(1), 16);
  let channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let fill = hex;
  for (let step = 0; step < 25 && contrastRatio(luminance(fill)!, inkLuminance) < 4.5; step++) {
    channels = channels.map((c) => c + (towards - c) * 0.04);
    fill = `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  }
  return fill;
}

/** A selected event's solid fill, as the current theme paints it (its title takes `contentInk`). */
export function contentFill(color: string): string {
  const key = paletteKey(color);
  return key ? `var(--pal-fill-${key}, ${legibleFill(color)})` : color;
}

/** The colours a title is drawn on: the events' (a selected one). */
const INKED: readonly string[] = CONTENT_SOURCES.google;

/**
 * The palette rules for the page head. A theme with a palette sets every
 * colour and the ink of each `INKED` one; the others set them to `initial`,
 * which a theme preview nested inside another theme (the Settings picker)
 * needs so it shows its own colours rather than inheriting the page's.
 */
export function contentPaletteCss(): string {
  const rules: string[] = [];
  const plain: string[] = [];
  const keys = [...new Set(Object.values(CONTENT_SOURCES).flat())].map((hex) => hex.slice(1));
  for (const theme of THEME_VALUES) {
    const palette = CONTENT_PALETTES[theme];
    if (!palette) {
      plain.push(`[data-theme="${theme}"]`);
      continue;
    }
    const declarations = keys.map((key) => `--pal-${key}:${palette[`#${key}`]}`);
    for (const hex of INKED) {
      declarations.push(`--pal-ink-${hex.slice(1)}:${readableOn(palette[hex])}`);
    }
    for (const hex of CONTENT_SOURCES.google) {
      declarations.push(`--pal-fill-${hex.slice(1)}:${legibleFill(palette[hex])}`);
    }
    rules.push(`[data-theme="${theme}"]{${declarations.join(";")}}`);
  }
  const reset = [
    ...keys.map((key) => `--pal-${key}:initial`),
    ...INKED.map((hex) => `--pal-ink-${hex.slice(1)}:initial`),
    ...CONTENT_SOURCES.google.map((hex) => `--pal-fill-${hex.slice(1)}:initial`),
  ];
  return [`${plain.join(",")}{${reset.join(";")}}`, ...rules].join("\n");
}
