"use client";

/*
 * The page's scroll, held still while a card is open. The app scrolls inside
 * its shell and the body never scrolls (lib/document-scroll-rules); this
 * holds the body as well, and keeps the room a scrollbar had, should the
 * window ever show one.
 */

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

/**
 * Hold the page still under a card, and give it back with the function
 * returned. Any number of cards can hold it; the page scrolls again once
 * the last lets go.
 *
 * Stopping the scroll takes the scrollbar away with it, and with it the
 * room `scrollbar-gutter: stable` keeps for it: Chrome keeps that room for a
 * scrolling page but not for one whose overflow is hidden, so the page would
 * grow by a scrollbar and everything centred on it move sideways as a card
 * opened, and back as it closed, on a Mac set to always show scroll bars. So
 * whatever room the browser takes away is held back as padding on <html>,
 * and every box stays where it was, in a browser that keeps the room as well
 * as one that does not. The card's own backdrop, fixed to the window, still
 * covers where the scrollbar was.
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
    const owner = document.body;
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
      /* Expected gone until measured, so anything fixed that measures the
         page in an observer of its own never sees the page wider. */
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
  if (taken === lock.held) return;
  lock.held = taken;
  root.style.paddingRight = taken > 0 ? `${taken}px` : lock.paddingRight;
}

function endLock(lock: PageLock) {
  if (pageLock !== lock) return;
  lock.observer?.disconnect();
  window.clearTimeout(lock.timer);
  document.documentElement.style.paddingRight = lock.paddingRight;
  pageLock = null;
}
