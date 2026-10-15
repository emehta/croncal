"use client";

import { useEffect, useState } from "react";
import { todayStr } from "@/lib/date-utils";

/**
 * Today's date key, which turns over at midnight, so a calendar left open
 * overnight does not go on counting yesterday as today. Checked again when
 * the tab comes back into view, since a sleeping computer's timers run late.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayStr);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => setToday(todayStr());
    const untilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      // A second past it, so the check lands on the new day.
      timer = setTimeout(() => { check(); untilMidnight(); }, midnight.getTime() - now.getTime() + 1000);
    };
    untilMidnight();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return today;
}
