/**
 * The clock and first weekday a new user starts with (src/lib/locale-defaults.ts),
 * before they choose either in Settings. Wrong here leaves no error, only a
 * list that reads "15:00" to someone in New York, or a date picker that
 * starts its weeks on the wrong day. `npm test -- locale`.
 */

import {
  clockFromHourCycle,
  firstDayFromWeekInfo,
  localeClock,
  localeFirstDay,
} from "@/lib/locale-defaults";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

// ─── Intl's own answers, read ───
check("h12 is a 12-hour clock", clockFromHourCycle("h12"), "12h");
check("h11 (0 to 11, Japan's AM/PM) is a 12-hour clock", clockFromHourCycle("h11"), "12h");
check("h23 is a 24-hour clock", clockFromHourCycle("h23"), "24h");
check("h24 is a 24-hour clock", clockFromHourCycle("h24"), "24h");
check("no hour cycle is no answer", clockFromHourCycle(undefined), null);

check("CLDR 1 is Monday", firstDayFromWeekInfo(1), "monday");
check("CLDR 7 is Sunday", firstDayFromWeekInfo(7), "sunday");
check("a Saturday week starts on the Sunday after", firstDayFromWeekInfo(6), "sunday");
check("a Friday week starts on the Sunday after", firstDayFromWeekInfo(5), "sunday");
check("nothing is no answer", firstDayFromWeekInfo(undefined), null);
check("a value outside 1 to 7 is no answer", [0, 8, 1.5, Number.NaN].map(firstDayFromWeekInfo), [null, null, null, null]);

// ─── Real locales, through this Node's Intl ───
const clocks = { "en-US": "12h", "en-GB": "24h", "de-DE": "24h", "fr-FR": "24h", "en-IN": "12h", "en-AU": "12h", "ja-JP": "24h", "ko-KR": "12h" };
for (const [locale, expected] of Object.entries(clocks)) check(`${locale} clock`, localeClock(locale), expected);

const weeks = { "en-US": "sunday", "en-GB": "monday", "de-DE": "monday", "fr-FR": "monday", "en-CA": "sunday", "ja-JP": "sunday", "ar-EG": "sunday", "en-AU": "monday" };
for (const [locale, expected] of Object.entries(weeks)) check(`${locale} first day`, localeFirstDay(locale), expected);
check("a language with no region reads as the region it most likely means", localeFirstDay("en"), "sunday");
check("and German alone as Germany", localeFirstDay("de"), "monday");

check("a tag Intl refuses falls back rather than throwing", [localeClock("not a locale!"), localeFirstDay("not a locale!")], ["24h", "sunday"]);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`locale-defaults: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`locale-defaults: ${passed} passed`);
