/**
 * The page colour for the very first frame, before the stylesheet arrives.
 *
 * On a reload the browser paints the new document as soon as it can, and
 * until `globals.css` has loaded nothing on the page has a colour, so that
 * frame came out in the browser's default white, even on a dark page. The
 * pre-paint script in `layout.tsx` sets these on <html> inline, which needs no
 * stylesheet at all, and takes them off again once the page has loaded.
 *
 * They are copies of `--page-bg` for each app theme and `--public-bg` for each
 * public one, because a script that runs before the CSS cannot read the CSS.
 * `npm test -- first-paint` fails if a copy stops matching `globals.css`.
 */

/** `--page-bg`, keyed by `data-theme`; Midnight is the absence of one. */
export const APP_FIRST_PAINT: Record<string, string> = {
  midnight: "#1c1c1c",
  light: "#f7f8f7",
  warm: "#211a15",
  nature: "#132015",
  onyx: "#000000",
  indigo: "#161b2b",
  dusk: "#232136",
  oxblood: "#280b11",
  paper: "#efe4cc",
};

/** `--public-bg`, keyed by `data-public-theme`; light is the absence of one. */
export const PUBLIC_FIRST_PAINT: Record<string, string> = {
  light: "#ffffff",
  dark: "#1c1c1c",
};

/**
 * Public pages that open in a theme of their own, whatever the visitor chose
 * elsewhere: /social is dark every visit (the owner's ask, 30 Sep 2026). The
 * pre-paint script reads this so the first frame is right, and
 * lib/public-theme holds it while the page is open.
 */
export const PUBLIC_PAGE_THEMES: Readonly<Record<string, "light" | "dark">> = { "/social": "dark" };
