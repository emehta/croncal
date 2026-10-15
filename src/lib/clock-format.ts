/**
 * A time of day as the app writes it ("3:42 PM", "15:42"), given the format:
 * no preference read and no React, so server code can share it.
 * lib/time-format reads the owner's preference and
 * holds the hook; its `formatTime` is this.
 */

export type TimeFormatPref = "12h" | "24h";

/*
 * The two formatters, held. `toLocaleTimeString` builds one per call (about
 * 40 microseconds), and the calendar formats every event's times on every
 * render, 1,500 or more across its strip of days. A held formatter keeps the
 * time zone it was made in, so they are made again when this device's zone
 * changes (a flight), which the offsets on two fixed days of the year tell.
 */
const JANUARY = new Date(2026, 0, 1);
const JULY = new Date(2026, 6, 1);
let timeFormatters: { zone: string; h12: Intl.DateTimeFormat; h24: Intl.DateTimeFormat } | null = null;

function timeFormatter(is24: boolean): Intl.DateTimeFormat {
  const zone = `${JANUARY.getTimezoneOffset()}/${JULY.getTimezoneOffset()}`;
  if (timeFormatters?.zone !== zone) {
    timeFormatters = {
      zone,
      h12: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
      h24: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: false }),
    };
  }
  return is24 ? timeFormatters.h24 : timeFormatters.h12;
}

/** A Date's time of day in `format`. */
export function formatClock(date: Date, format: TimeFormatPref): string {
  return timeFormatter(format === "24h").format(date);
}
