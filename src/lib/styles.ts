import type { CSSProperties } from "react";
import { contentColor } from "@/lib/content-palette";

/**
 * The surface every dialog and flyout sits on.
 *
 * Frosted rather than solid: a flat, opaque --page-bg card on a blurred
 * backdrop reads as a rectangle pasted over the app rather than a panel
 * floating above it. A translucent surface over its own blur keeps the page
 * legible underneath.
 *
 * No inner top highlight: on top of the 1px border it draws a second line,
 * so the top edge reads twice as thick as the other three. The edge is the
 * border, the same weight all the way round.
 *
 * color-mix keeps this themed: it resolves against whatever --c-surface is
 * for the active theme, so there is no hardcoded colour to keep in step.
 */
export const GLASS_POPOVER: CSSProperties = {
  background: "color-mix(in srgb, var(--c-surface) 80%, transparent)",
  backdropFilter: "blur(24px) saturate(150%)",
  WebkitBackdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--c-border)",
  boxShadow: "var(--shadow-pop)",
};

/**
 * One selectable option in a group: a filter chip, a category picker, a mode
 * switch. Pair with the `.ui-choice` class, which owns the unselected hover
 * state and keys off aria-pressed.
 *
 * Square, one border weight, one selected treatment, so every group of
 * options in the app draws "selected" the same way.
 *
 * Where an option has a colour of its own, carry it with a dot rather than by
 * recolouring the control, so a row of them reads as one group.
 */
export const CHOICE_CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "6px 12px",
  borderRadius: "var(--ui-radius-md)",
  fontSize: "var(--ui-type-label)",
  cursor: "pointer",
  transition: "var(--transition-ui)",
  whiteSpace: "nowrap",
};

/**
 * The one selected look: an accent wash and border, and a bold label. See
 * --c-selected-bg in globals.css. Every tab, segment and chip uses this.
 */
export const SELECTED: CSSProperties = {
  background: "var(--c-selected-bg)",
  border: "1px solid var(--c-selected-border)",
  color: "var(--c-text-1)",
  fontWeight: 600,
};

export const CHOICE_CHIP_SELECTED: CSSProperties = SELECTED;

export const CHOICE_CHIP_UNSELECTED: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--c-border)",
  color: "var(--c-text-3)",
  fontWeight: 400,
};

/**
 * Viewport width below which the signed-in app uses its phone layout.
 *
 * One number for the whole app shell: the header, the page gutters and the
 * page's own layout all have to turn over at the same moment, and a header on
 * phone gutters over a page still on desktop ones reads as a bug rather than
 * a layout.
 */
export const APP_PHONE_BREAKPOINT = 620;

/**
 * The app shell's horizontal gutter, in pixels.
 *
 * Everything with a left or a right edge on a signed-in page is measured from
 * these two numbers: the header, and the scrolling column the pages render
 * into, so the bar's contents and the page's line up the whole way down.
 *
 * A gutter is not a per-component decision, so it is not stated per component.
 * Import these rather than writing a number; a page that deliberately differs
 * says so where it does it.
 */

export const APP_GUTTER = 32;
export const APP_GUTTER_PHONE = 16;

/**
 * The room kept at the foot of a signed-in page (`--app-nav-clearance`,
 * which AppShell sets).
 *
 * AppShell ends <main>'s scroll with this much room, so a page that scrolls
 * <main> needs nothing. A page that fills the screen and scrolls inside
 * itself reaches over that room with `UNDER_DOCK_MARGIN` and puts
 * `DOCK_ROOM` at the end of its own scroller instead, so its last row still
 * ends clear of the edge.
 */
export const DOCK_ROOM = "var(--app-nav-clearance, 104px)";
export const UNDER_DOCK_MARGIN = `calc(-1 * ${DOCK_ROOM})`;

/**
 * The app header's height: the bar with the name and Settings, floating
 * over the top of every signed-in page, with the page scrolling up under it.
 * AppShell measures the bar into the variable, so a reader's larger text
 * that makes it taller moves the page down with it; 56 is a desktop's.
 * AppShell starts <main>'s content below it. A page that scrolls inside
 * itself from the top of <main> reaches up over it and starts its own
 * scroller's content below it instead. A sticky element in a page needs
 * nothing: its `top` counts from inside <main>'s padding, which already
 * holds the header.
 */
export const HEADER_ROOM = "var(--app-header-height, 56px)";

/**
 * An event's block: a tint of its colour over the surface. A finished event
 * takes half the tint. See --event-fill in globals.css. The colour is the
 * theme's version of it (lib/content-palette), so these take the stored one.
 */
export function eventFill(color: string, past = false): string {
  const share = past ? "var(--event-fill-past, 15%)" : "var(--event-fill, 30%)";
  return `color-mix(in srgb, ${contentColor(color)} ${share}, var(--c-surface))`;
}

/** Text on an event block: its colour mixed with the theme's own ink. */
export function eventInk(color: string): string {
  return `color-mix(in srgb, ${contentColor(color)} var(--event-ink, 14%), var(--c-text-1))`;
}

/**
 * The calendar's right-hand column, and the gap before it.
 *
 * The grid card, the sidebar and the header controls above them all measure
 * from these, so their right edges line up.
 */
export const CALENDAR_SIDEBAR_WIDTH = 200;
export const CALENDAR_COLUMN_GAP = 12;

/**
 * The page header: the title row every signed-in page opens with, and the gap
 * between it and the page's content.
 *
 * 32px is the line box of `text-2xl font-bold`, which is what a page title
 * is, so it is also the natural height of the row holding one. Controls
 * beside the title have to fit inside it: anything taller wins the row and
 * pushes the title down.
 *
 * A page that reaches back over the shell's gutters to run its scroller to
 * the screen edge is deliberately outside this: its header sits in a
 * different coordinate space, and standardising it would undo that.
 */
export const PAGE_HEADER_HEIGHT = 32;
export const PAGE_HEADER_GAP = 20;

/**
 * A content hue as text, mixed with the theme's own ink: the inline twin of
 * `.ui-hue-ink` in globals.css, for style objects that take a colour value.
 * Works on hex and on `var()` alike.
 */
export function hueInk(color: string): string {
  return `color-mix(in srgb, ${color} var(--hue-ink, 40%), var(--c-text-1))`;
}
