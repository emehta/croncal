/**
 * The page's scroll rule, in a module of its own so the root layout, a
 * server component, can write it into its own <style>. There it arrives
 * with the HTML and cannot be missing from a stale CSS chunk. The body stays
 * still; the app's shell scrolls inside its own box.
 */
export const DOCUMENT_SCROLL_CSS = `
  body { height: 100dvh; overflow: hidden; }
`;
