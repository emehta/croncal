"use client";

import { useLayoutEffect } from "react";
import { DOCUMENT_SCROLL_ATTRIBUTE } from "@/lib/document-scroll-rules";

/**
 * The public pages scroll the document itself; the signed-in app scrolls
 * inside its shell.
 *
 * Every public page used to scroll inside its own full-screen box, with the
 * body held at the screen's height and `overflow: hidden`. That box scrolled
 * well, but a phone's browser only gives the page its own gestures when the
 * document scrolls: pull down at the top and nothing refreshed, and a page
 * too short to scroll (/social) did not bounce at all (the owner, 30 Sep
 * 2026). So a public page marks <html> with this attribute while it is on
 * screen, and the rules in the root layout's head let the body grow and the
 * document scroll. The app's pages never set it, so the shell is unchanged.
 *
 * The rules themselves are in lib/document-scroll-rules.
 */

/* A count, not a flag, so a page handed over to the next one on a client
   navigation cannot take the attribute away from the page arriving. */
let holders = 0;
let smoothHolders = 0;

/**
 * Scroll the document while this page is mounted. `smooth` also makes the
 * document's own scrolling smooth, as the landing page's box was, for its
 * in-page links; the reduced-motion rule in globals.css still turns it off.
 */
export function useDocumentScroll({ smooth = false }: { smooth?: boolean } = {}): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    holders += 1;
    root.setAttribute(DOCUMENT_SCROLL_ATTRIBUTE, "");
    if (smooth) {
      smoothHolders += 1;
      root.style.scrollBehavior = "smooth";
    }
    return () => {
      holders -= 1;
      if (holders === 0) root.removeAttribute(DOCUMENT_SCROLL_ATTRIBUTE);
      if (smooth) {
        smoothHolders -= 1;
        if (smoothHolders === 0) root.style.removeProperty("scroll-behavior");
      }
    };
  }, [smooth]);
}

/* A card holding the page still (lockDocumentScroll): what it changed, so
   the last to let go can put it back. */
type PageLock = {
  /** The element whose overflow is the window's, and its own before. */
  owner: HTMLElement;
  overflow: string;
  /** <html>'s inline padding before. */
  paddingRight: string;
  /** The scrollbar's width when the page was locked: 0 for an overlay one. */
  bar: number;
  /** How much of it the browser took away, held back as padding. */
  held: number;
  /** Whether that has been measured yet. */
  measured: boolean;
  /** Let go, and waiting for the scrollbar to come back. */
  releasing: boolean;
  observer: ResizeObserver | null;
  timer: number;
};

let pageLock: PageLock | null = null;
let scrollLocks = 0;
/* The scrollbar's room the lock is holding open, which scrollerFrame takes
   off the window's width. */
let heldGutter = 0;

/**
 * Hold the page still under a card, and give it back with the function
 * returned. Any number of cards can hold it; the page scrolls again once
 * the last lets go.
 *
 * Stopping the scroll takes the scrollbar away with it, and with it went
 * the room `scrollbar-gutter: stable` keeps for it: Chrome keeps that room
 * for a scrolling page but not for one whose overflow is hidden, so the
 * page grew by a scrollbar and everything centred on it moved sideways,
 * right as a book's card opened and back as it closed (the owner, 7 Oct
 * 2026, on a Mac set to always show scroll bars). So whatever room the
 * browser takes away is held back as padding on <html>, and every box
 * stays where it was, in a browser that keeps the room as well as one that
 * does not. The card's own backdrop, fixed to the window, still covers
 * where the scrollbar was.
 *
 * Chrome takes the scrollbar away a frame later, not when the style is
 * set, so it cannot be measured here. A ResizeObserver on <html> measures
 * it instead, after layout and before paint, so no frame is ever drawn
 * shifted; on letting go, the padding stays until the scrollbar is back.
 * The room is measured as the scrollbar's own width, not the page's, so a
 * window resized under the card changes nothing.
 */
export function lockDocumentScroll(): () => void {
  const root = document.documentElement;
  if (!pageLock) {
    const owner = root.hasAttribute(DOCUMENT_SCROLL_ATTRIBUTE) ? root : document.body;
    const bar = Math.max(0, window.innerWidth - root.clientWidth);
    const lock: PageLock = {
      owner,
      overflow: owner.style.overflow,
      paddingRight: root.style.paddingRight,
      bar,
      held: 0,
      measured: false,
      releasing: false,
      observer: null,
      timer: 0,
    };
    pageLock = lock;
    if (bar > 0 && typeof ResizeObserver === "function") {
      /* Expected gone until measured, so the fixed nav, which measures the
         page in an observer of its own, never sees the page wider. */
      heldGutter = bar;
      lock.observer = new ResizeObserver(() => holdRoom(lock));
      lock.observer.observe(root, { box: "border-box" });
    }
    owner.style.overflow = "hidden";
  } else if (pageLock.releasing) {
    /* Held again before the scrollbar came back: carry on as before. */
    const lock = pageLock;
    lock.releasing = false;
    window.clearTimeout(lock.timer);
    lock.owner.style.overflow = "hidden";
    heldGutter = lock.measured ? lock.held : lock.bar;
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks > 0 || !pageLock) return;
    const lock = pageLock;
    lock.owner.style.overflow = lock.overflow;
    heldGutter = 0;
    if (lock.held === 0) {
      endLock(lock);
      return;
    }
    lock.releasing = true;
    /* In case the scrollbar never comes back, as on a page that has
       stopped scrolling. */
    lock.timer = window.setTimeout(() => endLock(lock), 1000);
  };
}

function scrollbarWidth(): number {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
}

function holdRoom(lock: PageLock) {
  if (pageLock !== lock) return;
  const root = document.documentElement;
  if (lock.releasing) {
    if (scrollbarWidth() >= lock.bar) endLock(lock);
    return;
  }
  const taken = Math.max(0, lock.bar - scrollbarWidth());
  lock.measured = true;
  heldGutter = taken;
  if (taken === lock.held) return;
  lock.held = taken;
  root.style.paddingRight = taken > 0 ? `${taken}px` : lock.paddingRight;
}

function endLock(lock: PageLock) {
  if (pageLock !== lock) return;
  lock.observer?.disconnect();
  window.clearTimeout(lock.timer);
  document.documentElement.style.paddingRight = lock.paddingRight;
  heldGutter = 0;
  pageLock = null;
}

/**
 * What the page under `from` scrolls in: the nearest ancestor whose overflow
 * scrolls (the sign-in page still has its own box), or else the document.
 * Found by computed overflow rather than by whether it overflows now, because
 * on a page's first frame it may not yet.
 */
export function pageScroller(from: Element | null): HTMLElement {
  let node = from?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Whether a scroller from `pageScroller` is the document itself. */
export function isDocumentScroller(scroller: Element): boolean {
  return scroller === document.scrollingElement || scroller === document.documentElement;
}

/**
 * Where a scroller's scroll events arrive: the window, for the document,
 * whose scrolling element never receives them.
 */
export function scrollEvents(scroller: HTMLElement): HTMLElement | Window {
  return isDocumentScroller(scroller) ? window : scroller;
}

/**
 * The scroller's box on screen. The document's is the viewport, less the
 * scrollbar, or the room a card's lock is holding for it (so the fixed nav
 * keeps its width if the window is resized under a card); its element's own
 * rectangle moves as it scrolls.
 */
export function scrollerFrame(scroller: HTMLElement): { top: number; left: number; width: number; height: number } {
  if (isDocumentScroller(scroller)) {
    const root = document.documentElement;
    return { top: 0, left: 0, width: root.clientWidth - heldGutter, height: root.clientHeight };
  }
  const box = scroller.getBoundingClientRect();
  return { top: box.top, left: box.left, width: scroller.clientWidth, height: scroller.clientHeight };
}
