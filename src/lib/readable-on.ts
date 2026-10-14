/**
 * Which ink reads on a solid colour: near-black or white, whichever has the
 * higher WCAG contrast against it. Pure, so it can be tested:
 * `npm test -- readable-on`.
 *
 * For marks drawn on a content hue (a tick on a done habit's square), where
 * the hue is fixed and the theme cannot help. A white tick on the Learning
 * habit's yellow was 1.4:1; on the same yellow near-black is 12:1.
 */

const DARK_INK = "#141414";
const LIGHT_INK = "#ffffff";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rgb or #rrggbb colour, or null for anything else. */
export function luminance(hex: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const full = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const n = parseInt(full, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The ink for text or a mark on `hex`. White when the colour cannot be read. */
export function readableOn(hex: string): string {
  const bg = luminance(hex);
  if (bg === null) return LIGHT_INK;
  const onDark = contrastRatio(bg, luminance(DARK_INK)!);
  const onLight = contrastRatio(bg, 1);
  return onDark > onLight ? DARK_INK : LIGHT_INK;
}
