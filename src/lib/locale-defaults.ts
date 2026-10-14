/**
 * What a new user sees before they choose anything in Settings: the clock and
 * the first day of the week their own language and region use, as their
 * other apps do. Someone in London gets 24h and Monday, someone in New York
 * 12h and Sunday. A choice made in Settings is stored and always wins.
 *
 * Pure apart from reading `Intl`, and tested in scripts/locale-defaults.test.mjs.
 */

export type ClockStyle = "12h" | "24h";
export type FirstDay = "sunday" | "monday";

/** `hourCycle` as Intl resolves it: h11 and h12 are a 12-hour clock. */
export function clockFromHourCycle(hourCycle: string | undefined): ClockStyle | null {
  if (hourCycle === "h11" || hourCycle === "h12") return "12h";
  if (hourCycle === "h23" || hourCycle === "h24") return "24h";
  return null;
}

/**
 * CLDR's first day (1 Monday ... 7 Sunday). Only Sunday and Monday are
 * offered, so a week that starts on a Friday or Saturday (the Maldives, much
 * of the Middle East) starts on the Sunday after it, the nearer of the two.
 */
export function firstDayFromWeekInfo(firstDay: number | undefined): FirstDay | null {
  if (firstDay === undefined || !Number.isInteger(firstDay) || firstDay < 1 || firstDay > 7) return null;
  return firstDay >= 5 ? "sunday" : "monday";
}

export function localeClock(locale?: string): ClockStyle {
  try {
    const hourCycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    return clockFromHourCycle(hourCycle) ?? "24h";
  } catch {
    return "24h";
  }
}

interface WeekInfo {
  firstDay?: number;
}

export function localeFirstDay(locale?: string): FirstDay {
  try {
    const tag = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
    // maximize() fills in the region, so a bare "en" reads as the region it most likely means.
    const full = new Intl.Locale(tag).maximize() as Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };
    // getWeekInfo() is the current name; older engines had a weekInfo getter.
    const info = typeof full.getWeekInfo === "function" ? full.getWeekInfo() : full.weekInfo;
    return firstDayFromWeekInfo(info?.firstDay) ?? "sunday";
  } catch {
    return "sunday";
  }
}
