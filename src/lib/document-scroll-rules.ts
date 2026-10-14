/**
 * The rules behind `useDocumentScroll` (lib/document-scroll), in a module of
 * their own so the root layout, a server component, can import them.
 *
 * They are written into the layout's own <style>, not globals.css, so they
 * arrive with the HTML and cannot be missing from a stale CSS chunk: a public
 * page whose box has stopped scrolling, without the rule that lets the
 * document scroll instead, would not scroll at all. The body's lock is the
 * default, so the signed-in app keeps it exactly as it was.
 */
export const DOCUMENT_SCROLL_ATTRIBUTE = "data-document-scroll";

export const DOCUMENT_SCROLL_CSS = `
  body { height: 100dvh; overflow: hidden; }
  html[${DOCUMENT_SCROLL_ATTRIBUTE}] { scrollbar-gutter: stable; }
  html[${DOCUMENT_SCROLL_ATTRIBUTE}] body { height: auto; min-height: 100dvh; overflow: visible; }
`;
