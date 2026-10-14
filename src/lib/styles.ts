import type { CSSProperties } from "react";
import { contentColor } from "@/lib/content-palette";

/** Standard raised card: the default surface for panels and detail views. */
export const GLASS_CARD: CSSProperties = {
  background: "var(--c-card-bg)",
  border: "1px solid var(--c-border)",
  borderRadius: "var(--ui-radius-lg)",
  boxShadow: "var(--shadow-soft)",
};

/**
 * Flatter inset card, for cards nested inside another card where a second drop
 * shadow would read as clutter. The stats panel used a private copy of this.
 */
export const GLASS_CARD_INSET: CSSProperties = {
  background: "var(--c-surface)",
  border: "1px solid var(--c-border)",
  borderRadius: "var(--ui-radius-lg)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
};

/**
 * The surface every dialog and flyout sits on.
 *
 * Frosted rather than solid: the card was --page-bg, flat and opaque, which
 * on a blurred backdrop reads as a rectangle pasted over the app rather than
 * a panel floating above it. A translucent surface over its own blur keeps
 * the page legible underneath.
 *
 * No inner top highlight. It was meant to light the top edge, but on top of
 * the 1px border it drew a second line there, so every dialog read as having
 * a top border twice as thick as its other three. The owner asked for it gone
 * on 28 Sep 2026; the edge is the border, the same weight all the way round.
 *
 * color-mix keeps this themed — it resolves against whatever --c-surface is
 * for the active theme, so there is no fifth hardcoded colour to keep in step.
 */
export const GLASS_POPOVER: CSSProperties = {
  background: "color-mix(in srgb, var(--c-surface) 80%, transparent)",
  backdropFilter: "blur(24px) saturate(150%)",
  WebkitBackdropFilter: "blur(24px) saturate(150%)",
  border: "1px solid var(--c-border)",
  boxShadow: "var(--shadow-pop)",
};

/**
 * The surface a "more options" menu sits on, inside a Popover.
 *
 * --page-bg rather than the frosted popover surface: a menu of one-line items
 * has to stay legible over whatever it covers, and a blur behind ten words of
 * 12px text reads as smudged rather than as depth. Width stays with the menu,
 * which knows how long its own labels are.
 */
export const MENU_PANEL: CSSProperties = {
  background: "var(--page-bg)",
  border: "1px solid var(--c-border)",
  borderRadius: "var(--ui-radius-lg)",
  boxShadow: "var(--shadow-pop)",
};

/**
 * One selectable option in a group: a filter chip, a category picker, a mode
 * switch. Pair with the `.ui-choice` class, which owns the unselected hover
 * state and keys off aria-pressed.
 *
 * Square, one border weight, one selected treatment — the shape the calendar's
 * view switcher already uses. (Tasks' All/Overdue/Historical tabs were the
 * other example and are a picker now: three mutually exclusive options that
 * answer the same question as the two filters beside them, so they read as one
 * of those rather than as a row of chips.) Worth centralising because the
 * habits area had grown three different answers to the same question: the grid
 * filter, the completion chart's filter and the habit form's category picker
 * each drew "selected" their own way, two of them as lozenges with a 1.5px
 * border in the category's own colour.
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
 * dashboard grids all have to turn over at the same moment, and a header that
 * stacks while the page is still on desktop gutters reads as a bug rather than
 * a layout. 620 is also where the header already drops its world clocks.
 */
export const APP_PHONE_BREAKPOINT = 620;

/**
 * The app shell's horizontal gutter, in pixels.
 *
 * Everything with a left or a right edge on a signed-in page is measured from
 * these two numbers: the header, and the scrolling column the pages render
 * into. They were separate literals, and they disagreed — the header inset its
 * contents 24px against the page's 32px on every viewport under 1800, which is
 * to say on every laptop. The weather pill sat 8px left of the page heading
 * and the world clocks sat 8px right of the cards, the whole way down.
 *
 * A gutter is not a per-component decision, so it is not stated per component.
 * Import these rather than writing a number; the one page that deliberately
 * differs is /tasks, which says so where it does it.
 */
/**
 * How tall a pill in the app header stands.
 *
 * The header holds two families that look like one object — the conditions
 * pill with the place and the temperature, and the world clocks — and they
 * were sized by whatever their own text happened to measure. That came out
 * 28px against 26.5px, so two pills side by side in the same row differed in
 * height and the shorter pair sat on a fractional pixel (`top: 10.75`),
 * which renders a soft border on a retina screen. Invisible while the phone
 * header stacked them on separate lines; not once they share one.
 *
 * `minHeight`, not `height`: it equalises the two today and still cannot clip
 * anything if a font loads wide or the reader scales their text up.
 */
export const HEADER_PILL_HEIGHT = 28;

export const APP_GUTTER = 32;
export const APP_GUTTER_PHONE = 16;

/**
 * The room the floating dock needs at the foot of a signed-in page.
 *
 * Every page runs to the bottom edge of the screen, under the dock and its
 * blur (the owner, 9 Oct 2026: no hard line above the dock). AuthGate ends
 * <main>'s scroll with this much room, so a page that scrolls <main> needs
 * nothing. A page that fills the screen and scrolls inside itself (Tasks,
 * the calendar's hours, Journal, Gratitude, the script board) reaches over
 * that room with `UNDER_DOCK_MARGIN` and puts `DOCK_ROOM` at the end of its
 * own scroller instead, so its last row can still rise clear of the dock.
 */
export const DOCK_ROOM = "var(--app-nav-clearance, 104px)";
export const UNDER_DOCK_MARGIN = `calc(-1 * ${DOCK_ROOM})`;

/**
 * The app header's height: the weather and the world clocks, floating over
 * the top of every signed-in page the way the dock floats over its foot,
 * with the page scrolling under them into a blur that runs out a quarter of
 * the header below it at rest and two thirds once the page scrolls (the
 * owner, 11 Oct 2026; see Header).
 * Header measures itself into the variable, so a reader's larger text that
 * makes it taller moves the page down with it; 56 is a desktop's at rest.
 * AuthGate starts <main>'s content below it. A page that scrolls inside
 * itself from the top of <main> (Tasks) reaches up over it and starts its
 * own scroller's content below it instead. A sticky element in a page needs
 * nothing: its `top` counts from inside <main>'s padding, which already
 * holds the header (measured: `top: 16` sits 96px down on a desktop).
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

/*
 * An open task in its priority's colour (`PRIORITY_COLORS`): the fill and
 * edge of a row on /tasks and of a pill on the calendar, so a Critical is
 * the same red in both. How much hue each theme takes, and what it is mixed
 * into, are the --priority-wash* variables, which
 * components/tasks/PriorityWash.module.css sets on whatever carries the
 * class. The fallbacks are Midnight's, so a stylesheet that arrives late
 * leaves the task tinted, never transparent.
 */

/** A task's fill; `hover` is the row under the cursor, a little more of its hue. */
export function priorityFill(hue: string, hover = false): string {
  const share = hover ? "var(--priority-wash-hover, 23%)" : "var(--priority-wash, 16%)";
  return `color-mix(in srgb, ${hue} ${share}, var(--priority-wash-base, var(--c-surface)))`;
}

/** A task's edge. */
export function priorityLine(hue: string): string {
  return `color-mix(in srgb, ${hue} var(--priority-wash-line, 30%), var(--c-border-sub))`;
}

/**
 * The calendar's right-hand column, and the gap before it.
 *
 * The grid card, the sidebar and the header controls above them all measure
 * from these. They were three separate numbers, so the Today group's right
 * edge missed the grid card's by five pixels — close enough to read as a
 * misalignment rather than a choice.
 */
export const CALENDAR_SIDEBAR_WIDTH = 200;
export const CALENDAR_COLUMN_GAP = 12;

/**
 * The page header: the title row every signed-in page opens with, and the gap
 * between it and the page's content.
 *
 * These were five separate answers to the same question. Measured at 1440px
 * before this existed, the title's own line box and the distance to the first
 * block below it came out as:
 *
 *   calendar  title 8.5px down, 26.4px tall, content at 55.5px
 *   habits    title flush,      32px tall,   content at 52px
 *   finance   title flush,      32px tall,   content at 44px
 *   reflect   title flush,      32px tall,   content at 56px
 *   tools     title flush,      32px tall,   content at 56px
 *
 * Four different starting heights for the content, and a calendar title
 * sitting lower than the other four in a shorter box — the month name looked
 * misaligned against every other page because it was.
 *
 * 32px is the line box of `text-2xl font-bold`, which is what a page title is
 * (see CLAUDE.md), so it is also the natural height of the row holding one.
 * Controls beside the title have to fit inside it: anything taller wins the
 * row and pushes the title down, which is exactly how the calendar's nav
 * cluster ended up moving its own title 8.5px off.
 *
 * `/tasks` is deliberately outside this. It reaches back over the shell's
 * gutters to run its scroller to the screen edge, so its header sits in a
 * different coordinate space and standardising it would undo that.
 */
export const PAGE_HEADER_HEIGHT = 32;
export const PAGE_HEADER_GAP = 20;

/**
 * The bordered button on the surface colour: Try again under an error, a
 * filter's trigger. Tools and Reflect each kept an identical copy of it when
 * it was also the Back button, which is now the arrow on the title's line
 * (components/BackButton).
 */
export const SURFACE_BUTTON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: "var(--ui-radius-md)",
  border: "1px solid var(--c-border)",
  background: "var(--c-surface)",
  color: "var(--c-text-2)",
  fontSize: "var(--ui-type-body-sm)",
  fontWeight: 600,
  cursor: "pointer",
  transition: "var(--transition-ui)",
};

export const PAGE_HEADER_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  minHeight: PAGE_HEADER_HEIGHT,
  marginBottom: PAGE_HEADER_GAP,
  flexShrink: 0,
};

/**
 * The centred column a scannable list of rows sits in.
 *
 * `/tasks` measured this first. A row in one of these lists is a line of text
 * with a couple of fields pinned to its right edge, and run to the full width
 * of a 1440px monitor it is both tiring to read and pointlessly sparse — the
 * description ends a third of the way across and the amount sits half a screen
 * away from it. Finance's transaction table is the same object, one row per
 * line scanned top to bottom, so it takes the same column rather than a second
 * number arrived at by eye. Two literals disagreeing by twenty pixels is how
 * the app got four radii; a width is no different.
 *
 * Only the list takes it. The filter line and the summary cards above stay on
 * the shell's full width, because a card grid is not something you read a line
 * at a time.
 */
export const LIST_COLUMN_WIDTH = 780;

/**
 * A content hue as text, mixed with the theme's own ink: the inline twin of
 * `.ui-hue-ink` in globals.css, for style objects that take a colour value.
 * Works on hex and on `var()` alike.
 */
export function hueInk(color: string): string {
  return `color-mix(in srgb, ${color} var(--hue-ink, 40%), var(--c-text-1))`;
}
