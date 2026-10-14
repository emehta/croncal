"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Act on a query parameter once, then take it back out of the URL.
 *
 * Universal search points at records rather than pages — `/tasks?task=…`,
 * `/journal?view=dreams&dream=…`, `/tracker?new=1` — and every one of those
 * pages needs the same four things:
 *
 *  - wait until the data the id refers to has actually loaded,
 *  - act exactly once,
 *  - strip the parameter afterwards, so a refresh does not reopen the dialog
 *    and Back does not bounce straight into it again,
 *  - keep the *other* parameters, because `?tool=scripting&script=…` still
 *    has to be on the scripting board once the card has opened.
 *
 * Six copies of that would drift; this is one. `ready` is what lets a page
 * hold the target until its rows are in — the effect re-runs when it flips,
 * so a deep link that arrives before the fetch is honoured when it lands
 * rather than dropped.
 *
 * The callback is held in a ref and refreshed from an effect, not assigned
 * during render: a page passes a fresh closure over its own state every time,
 * and putting that in the dependency list would re-fire the target on each
 * render.
 */
export function useUrlTarget(
  param: string,
  ready: boolean,
  onTarget: (value: string) => void,
): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(param);

  const callback = useRef(onTarget);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    callback.current = onTarget;
  });

  useEffect(() => {
    /*
     * Cleared rather than left set. Without this, searching the same task
     * twice in a row does nothing the second time — the parameter is stripped
     * after the first, so the value arriving again is one this has already
     * seen, and the guard would swallow it.
     */
    if (value === null) {
      handled.current = null;
      return;
    }

    if (!ready || handled.current === value) return;
    handled.current = value;
    callback.current(value);

    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [param, pathname, ready, router, searchParams, value]);
}
