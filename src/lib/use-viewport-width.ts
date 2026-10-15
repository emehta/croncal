"use client";

import { useSyncExternalStore } from "react";
import { APP_PHONE_BREAKPOINT } from "@/lib/styles";

/*
 * Media queries read through `useSyncExternalStore` rather than `useState` and
 * a resize effect: the effect version has to seed state with a guess and
 * correct it after the first paint, which flashes the desktop layout on a phone.
 */

interface WidthStore {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
}

/*
 * One store per width, made once. Written inline, `subscribe` would be a new
 * function every render, so React would unsubscribe and subscribe again (a
 * new matchMedia and its listener) on every render of every component that
 * asks, and every snapshot read would build another MediaQueryList.
 */
const widthStores = new Map<number, WidthStore>();

function widthStore(minWidth: number): WidthStore {
  let store = widthStores.get(minWidth);
  if (!store) {
    let query: MediaQueryList | null = null;
    const media = () => (query ??= window.matchMedia(`(min-width: ${minWidth}px)`));
    store = {
      subscribe: (onChange) => {
        const list = media();
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      },
      getSnapshot: () => media().matches,
    };
    widthStores.set(minWidth, store);
  }
  return store;
}

/** Whether the viewport is at least `minWidth` wide. */
export function useMinWidth(minWidth: number, serverValue = true): boolean {
  const store = widthStore(minWidth);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverValue);
}

/**
 * Whether this is the phone layout, by the app's one breakpoint.
 *
 * The single name for a question many components ask, so no copy of
 * `!useMinWidth(APP_PHONE_BREAKPOINT)` can mistype the breakpoint and lay a
 * page out for the wrong device.
 */
export function usePhone(): boolean {
  return !useMinWidth(APP_PHONE_BREAKPOINT);
}
