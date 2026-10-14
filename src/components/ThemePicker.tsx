"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { Check } from "@phosphor-icons/react";
import { contentColor } from "@/lib/content-palette";
import { THEME_LABELS, THEME_VALUES, type ThemeValue } from "@/lib/themes";
import styles from "./ThemePicker.module.css";

/**
 * The content colours a tile shows at full strength, red, yellow, green and
 * blue as the theme paints them (lib/content-palette): an event's Tomato,
 * Banana, Basil and Google's default blue.
 */
const CHIPS = ["#D50000", "#F6BF26", "#0B8043", "#4285F4"] as const;

/**
 * A theme, drawn as itself: its page, a card, a title, four of its content
 * colours and its accent.
 *
 * Every theme block in globals.css is an attribute selector, so an element
 * carrying `data-theme` takes that theme's variables for everything inside
 * it, whatever the page around it is wearing, and the tile is drawn in the
 * theme's own colours rather than a copy of them that could drift. Nothing
 * in it may lean on a rule written as "[data-theme=x] .class" (the task
 * tints were): the page's own theme matches that too, and won wherever its
 * rule came later in the sheet, which painted the Light tile's rows black
 * under Onyx (11 Oct 2026).
 */
function Preview({ theme }: { theme: ThemeValue }) {
  return (
    <span className={styles.preview} data-theme={theme} aria-hidden="true">
      <span className={styles.card}>
        <span className={styles.title} />
        <span className={styles.line} />
        <span className={styles.foot}>
          <span className={styles.chips}>
            {CHIPS.map((color) => (
              <span key={color} style={{ background: contentColor(color) }} />
            ))}
          </span>
          <span className={styles.accent} />
        </span>
      </span>
    </span>
  );
}

/** Which ends of the row have more tiles past them, for the fades. */
function markEnds(rail: HTMLElement) {
  const max = rail.scrollWidth - rail.clientWidth;
  rail.dataset.fadeStart = String(rail.scrollLeft > 1);
  rail.dataset.fadeEnd = String(rail.scrollLeft < max - 1);
}

/**
 * The colour theme, in Settings: one row of tiles that scrolls sideways, its
 * ends fading where more tiles wait (the owner, 11 Oct 2026: smaller, one
 * row, a fade and a sideways scroll). The order is lib/themes': the two
 * bases, their alternates, then the colours round the rainbow, with no
 * dividers (the owner's ask). `bleed` is the dialog's side padding, which
 * the row runs into so a tile scrolls out under the fade at the card's edge
 * rather than being cut at the padding.
 */
export default function ThemePicker({
  value,
  onChange,
  bleed,
}: {
  value: ThemeValue;
  onChange: (theme: ThemeValue) => void;
  bleed: number;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  /* Opened on the current theme: its tile in the middle of the row, at once. */
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const tile = rail.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (tile) {
      const centred = tile.offsetLeft - (rail.clientWidth - tile.offsetWidth) / 2;
      rail.scrollLeft = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, centred));
    }
    markEnds(rail);
    // Only on opening: a tile picked afterwards stays where the hand left it.
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const update = () => markEnds(rail);
    /*
     * A mouse wheel turns the row too. Only while the row has somewhere to go
     * in that direction: at either end the wheel scrolls the dialog as it
     * would anywhere else, so the row never traps it. A trackpad's sideways
     * swipe is left to the browser.
     */
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = rail.scrollWidth - rail.clientWidth;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      if (max <= 0 || (delta < 0 && rail.scrollLeft <= 0) || (delta > 0 && rail.scrollLeft >= max - 1)) return;
      event.preventDefault();
      rail.scrollLeft = Math.max(0, Math.min(max, rail.scrollLeft + delta));
    };
    const resize = new ResizeObserver(update);
    resize.observe(rail);
    rail.addEventListener("scroll", update, { passive: true });
    rail.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      rail.removeEventListener("scroll", update);
      rail.removeEventListener("wheel", wheel);
    };
  }, []);

  /* Left and Right move between tiles, Home and End to either end. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tiles = [...(railRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next =
      event.key === "ArrowRight" ? Math.min(tiles.length - 1, at + 1)
      : event.key === "ArrowLeft" ? Math.max(0, at - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? tiles.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    tiles[next].focus();
    tiles[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div
      ref={railRef}
      role="group"
      aria-label="Colour theme"
      className={styles.rail}
      style={{ marginInline: -bleed, paddingInline: bleed, scrollPaddingInline: bleed }}
      onKeyDown={onKeyDown}
    >
      {THEME_VALUES.map((theme) => {
        const active = theme === value;
        return (
          <button
            type="button"
            key={theme}
            onClick={() => onChange(theme)}
            aria-pressed={active}
            className={styles.tile}
          >
            <span className={styles.frame}>
              <Preview theme={theme} />
              {active && (
                <span className={styles.badge}>
                  <Check size={10} weight="bold" />
                </span>
              )}
            </span>
            <span className={styles.name}>{THEME_LABELS[theme]}</span>
          </button>
        );
      })}
    </div>
  );
}
