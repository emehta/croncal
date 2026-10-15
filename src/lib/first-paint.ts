/**
 * The page colour for the very first frame, before the stylesheet arrives.
 *
 * On a reload the browser paints the new document as soon as it can, and
 * until `globals.css` has loaded nothing on the page has a colour, so that
 * frame would come out in the browser's default white, even on a dark page.
 * The pre-paint script in `layout.tsx` sets these on <html> inline, which
 * needs no stylesheet at all, and takes them off again once the page has
 * loaded.
 *
 * They are copies of `--page-bg` for each theme, because a script that runs
 * before the CSS cannot read the CSS.
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
