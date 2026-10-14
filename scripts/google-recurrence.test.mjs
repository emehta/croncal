/**
 * Saving a change to a Google event: `npm test -- google-recurrence`.
 *
 * What is defended is a save that does not happen and says it did. A colour,
 * a type or an importance changed on a Google event sent Google nothing and
 * closed the dialog as saved (5 Oct 2026, "Gym - Chris"). Beside it: a
 * repeating Google series read as "Does not repeat", a series that could not
 * be changed as a whole, and Google's habit of throwing a series' changed
 * days away when its times change, which a save must undo.
 *
 * The calls are checked against a real calendar by hand (see google-edit.ts);
 * what is here is every decision they are built from.
 */

import {
  continueRecurrenceFrom,
  describeCustomRecurrence,
  endRecurrenceBefore,
  exceptionPlan,
  instanceId,
  reanchorRecurrence,
  rebaseSeriesTiming,
  recurrenceForRepeat,
  recurrenceHasCount,
  repeatFromRecurrence,
  restoreBody,
  shiftGoogleTime,
  slotAfterShift,
  timingAtSlot,
} from "@/lib/google-recurrence";
import { buildGoogleEventPatch } from "@/lib/google-event-changes";
import { changedFieldKeys, googleEventFields } from "@/app/api/google-calendar/events/google-payload";
import { googleColorId, mapGoogleEvent } from "@/lib/google-calendar";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SGT = "Asia/Singapore";
const NY = "America/New_York";
const sgt = (date, time) => ({ dateTime: new Date(`${date}T${time}:00+08:00`).toISOString(), timeZone: SGT });

/* ─── reading a rule as the form's repeat ───────────────────────────── */

// 2026-09-30 is a Wednesday, the first day of the owner's "Break".
const WED = "2026-09-30";
check("the owner's Break: every weekday", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"], WED), "weekdays");
check("weekdays in another order", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=FR,TH,WE,TU,MO"], WED), "weekdays");
check("the mirrored schedule: weekly, no day named", repeatFromRecurrence(["RRULE:FREQ=WEEKLY"], WED), "weekly");
check("weekly on its own day", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=WE"], WED), "weekly");
check("weekly on another day is custom", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=TU"], WED), "custom");
check("every two weeks", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"], WED), "biweekly");
check("every three weeks is custom", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;INTERVAL=3"], WED), "custom");
check("Mon, Wed and Fri is custom", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"], WED), "custom");
check("daily", repeatFromRecurrence(["RRULE:FREQ=DAILY"], WED), "daily");
check("every other day is custom", repeatFromRecurrence(["RRULE:FREQ=DAILY;INTERVAL=2"], WED), "custom");
check("monthly", repeatFromRecurrence(["RRULE:FREQ=MONTHLY"], WED), "monthly");
check("monthly on its own date", repeatFromRecurrence(["RRULE:FREQ=MONTHLY;BYMONTHDAY=30"], WED), "monthly");
check("monthly on another date is custom", repeatFromRecurrence(["RRULE:FREQ=MONTHLY;BYMONTHDAY=1"], WED), "custom");
check("the first Monday is custom", repeatFromRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=1MO"], WED), "custom");
check("yearly", repeatFromRecurrence(["RRULE:FREQ=YEARLY"], WED), "yearly");
check("yearly on its own day", repeatFromRecurrence(["RRULE:FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=30"], WED), "yearly");
check("an end does not make it custom", repeatFromRecurrence(["RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z;BYDAY=MO,TU,WE,TH,FR"], WED), "weekdays");
check("a count does not either", repeatFromRecurrence(["RRULE:FREQ=DAILY;COUNT=4"], WED), "daily");
check("skipped days beside the rule are fine", repeatFromRecurrence(["RRULE:FREQ=DAILY", "EXDATE;TZID=Asia/Singapore:20261005T180000"], WED), "daily");
check("added dates are custom", repeatFromRecurrence(["RRULE:FREQ=DAILY", "RDATE:20261005T100000Z"], WED), "custom");
check("two rules are custom", repeatFromRecurrence(["RRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY"], WED), "custom");
check("a part the form has no word for is custom", repeatFromRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1"], WED), "custom");
check("lower case is still read", repeatFromRecurrence(["rrule:freq=daily"], WED), "daily");
check("no rule: does not repeat", repeatFromRecurrence([], WED), "none");
check("no rule at all", repeatFromRecurrence(undefined, WED), "none");

check("custom label, three days", describeCustomRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]), "Every week on Mon, Wed and Fri");
check("custom label, two weeks", describeCustomRecurrence(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH"]), "Every 2 weeks on Tue and Thu");
check("custom label, first Monday", describeCustomRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=1MO"]), "Every month on the first Monday");
check("custom label, last Friday", describeCustomRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=-1FR"]), "Every month on the last Friday");
check("custom label, every three days", describeCustomRecurrence(["RRULE:FREQ=DAILY;INTERVAL=3"]), "Every 3 days");
check("custom label it cannot say", describeCustomRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1"]), "Custom, set in Google Calendar");
check("no label has a dash", [
  describeCustomRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]),
  describeCustomRecurrence(["RRULE:FREQ=HOURLY"]),
].some((label) => /[\u2013\u2014]/.test(label)), false);

/* ─── writing a repeat ──────────────────────────────────────────────── */

// 2026-10-05 is a Monday.
const MON = "2026-10-05";
check("weekdays", recurrenceForRepeat("weekdays", MON), ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]);
check("weekly names its day", recurrenceForRepeat("weekly", MON), ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
check("every two weeks", recurrenceForRepeat("biweekly", MON), ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"]);
check("daily", recurrenceForRepeat("daily", MON), ["RRULE:FREQ=DAILY"]);
check("monthly", recurrenceForRepeat("monthly", MON), ["RRULE:FREQ=MONTHLY"]);
check("yearly", recurrenceForRepeat("yearly", MON), ["RRULE:FREQ=YEARLY"]);
check("a new repeat keeps the end", recurrenceForRepeat("daily", MON, ["RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z;BYDAY=MO"]), ["RRULE:FREQ=DAILY;UNTIL=20261231T000000Z"]);
check("and a count", recurrenceForRepeat("weekly", MON, ["RRULE:FREQ=DAILY;COUNT=10"]), ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"]);
check("and the skipped days", recurrenceForRepeat("daily", MON, ["RRULE:FREQ=WEEKLY", "EXDATE:20261012T100000Z"]), ["RRULE:FREQ=DAILY", "EXDATE:20261012T100000Z"]);

check("moved a day, weekly on its day moves too", reanchorRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO"], MON, "2026-10-06"), ["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
check("weekly naming no day is left to follow", reanchorRecurrence(["RRULE:FREQ=WEEKLY"], MON, "2026-10-06"), ["RRULE:FREQ=WEEKLY"]);
check("weekdays stay weekdays", reanchorRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"], MON, "2026-10-06"), ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]);
check("a custom rule is not touched", reanchorRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], MON, "2026-10-06"), ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]);
check("monthly on its date moves", reanchorRecurrence(["RRULE:FREQ=MONTHLY;BYMONTHDAY=5"], MON, "2026-10-06"), ["RRULE:FREQ=MONTHLY;BYMONTHDAY=6"]);
check("the same day changes nothing", reanchorRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO"], MON, MON), ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);

/* ─── splitting a series at a day ───────────────────────────────────── */

const pivot = sgt("2026-10-05", "18:00"); // 10:00 UTC
check("ended a second before the day, in UTC", endRecurrenceBefore(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"], pivot, SGT), ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261005T095959Z"]);
check("a count becomes an end", endRecurrenceBefore(["RRULE:FREQ=DAILY;COUNT=10"], pivot, SGT), ["RRULE:FREQ=DAILY;UNTIL=20261005T095959Z"]);
check("an all-day series ends the day before", endRecurrenceBefore(["RRULE:FREQ=DAILY;COUNT=4"], { date: "2027-04-07" }, SGT), ["RRULE:FREQ=DAILY;UNTIL=20270406"]);
check("added dates after the end go", endRecurrenceBefore(["RRULE:FREQ=WEEKLY", "RDATE:20261001T100000Z,20261008T100000Z"], pivot, SGT), ["RRULE:FREQ=WEEKLY;UNTIL=20261005T095959Z", "RDATE:20261001T100000Z"]);
check("skipped days stay with the old series", endRecurrenceBefore(["RRULE:FREQ=WEEKLY", "EXDATE:20261008T100000Z"], pivot, SGT), ["RRULE:FREQ=WEEKLY;UNTIL=20261005T095959Z", "EXDATE:20261008T100000Z"]);

check("the new series counts what is left", continueRecurrenceFrom(["RRULE:FREQ=DAILY;COUNT=10"], pivot, SGT, 3), ["RRULE:FREQ=DAILY;COUNT=7"]);
check("an end date is kept", continueRecurrenceFrom(["RRULE:FREQ=DAILY;UNTIL=20261231T000000Z"], pivot, SGT, 0), ["RRULE:FREQ=DAILY;UNTIL=20261231T000000Z"]);
check("skipped days before the split stay behind", continueRecurrenceFrom(
  ["RRULE:FREQ=DAILY", "EXDATE;TZID=Asia/Singapore:20261002T180000,20261006T180000", "EXDATE:20261001T100000Z", "EXDATE;VALUE=DATE:20261009"],
  pivot, SGT, 0,
), ["RRULE:FREQ=DAILY", "EXDATE;TZID=Asia/Singapore:20261006T180000", "EXDATE;VALUE=DATE:20261009"]);
check("a line it cannot read is kept", continueRecurrenceFrom(["RRULE:FREQ=DAILY", "EXDATE:garbage"], pivot, SGT, 0), ["RRULE:FREQ=DAILY", "EXDATE:garbage"]);
check("knows a counted rule", [recurrenceHasCount(["RRULE:FREQ=DAILY;COUNT=4"]), recurrenceHasCount(["RRULE:FREQ=DAILY"])], [true, false]);

/* ─── a series' new times ───────────────────────────────────────────── */

const breakSeries = { start: sgt("2026-09-30", "18:00"), end: sgt("2026-09-30", "19:00") };
const monday = { start: sgt("2026-10-05", "18:00"), end: sgt("2026-10-05", "19:00") };

let rebased = rebaseSeriesTiming({ slot: breakSeries.start, from: monday, to: { start: sgt("2026-10-05", "18:30"), end: sgt("2026-10-05", "19:30") }, zone: SGT });
check("half an hour later: the series starts at 18:30 on its first day", [rebased.timing.start.dateTime, rebased.timing.end.dateTime, rebased.dayShift], [sgt("2026-09-30", "18:30").dateTime, sgt("2026-09-30", "19:30").dateTime, 0]);

rebased = rebaseSeriesTiming({ slot: breakSeries.start, from: monday, to: { start: sgt("2026-10-06", "18:00"), end: sgt("2026-10-06", "20:00") }, zone: SGT });
check("a day later and longer", [rebased.timing.start.dateTime, rebased.timing.end.dateTime, rebased.dayShift], [sgt("2026-10-01", "18:00").dateTime, sgt("2026-10-01", "20:00").dateTime, 1]);

const movedDay = { start: sgt("2026-10-05", "17:00"), end: sgt("2026-10-05", "18:00") };
rebased = rebaseSeriesTiming({ slot: breakSeries.start, from: movedDay, to: { start: sgt("2026-10-05", "17:30"), end: sgt("2026-10-05", "18:30") }, zone: SGT });
check("an hour typed on a moved day is the series' hour", rebased.timing.start.dateTime, sgt("2026-09-30", "17:30").dateTime);

rebased = rebaseSeriesTiming({ slot: breakSeries.start, from: monday, to: { start: { date: "2026-10-05" }, end: { date: "2026-10-06" } }, zone: SGT });
check("made all-day", rebased.timing, { start: { date: "2026-09-30" }, end: { date: "2026-10-01" } });

rebased = rebaseSeriesTiming({ slot: { date: "2026-09-30" }, from: { start: { date: "2026-10-05" }, end: { date: "2026-10-06" } }, to: { start: sgt("2026-10-05", "09:00"), end: sgt("2026-10-05", "10:00") }, zone: SGT });
check("all-day made timed", [rebased.timing.start.dateTime, rebased.timing.end.dateTime], [sgt("2026-09-30", "09:00").dateTime, sgt("2026-09-30", "10:00").dateTime]);

rebased = rebaseSeriesTiming({ slot: breakSeries.start, from: monday, to: { start: { dateTime: monday.start.dateTime, timeZone: NY }, end: { dateTime: monday.end.dateTime, timeZone: NY } }, zone: SGT });
check("a new zone alone keeps the instant", [rebased.timing.start.dateTime, rebased.timing.start.timeZone, rebased.dayShift], [breakSeries.start.dateTime, NY, 0]);

// New York's clocks go back on 1 Nov 2026: a series in October moved to 19:00 stays at 19:00 local.
const nySeries = { dateTime: "2026-10-26T22:00:00.000Z", timeZone: NY }; // 18:00 EDT
rebased = rebaseSeriesTiming({
  slot: nySeries,
  from: { start: { dateTime: "2026-11-02T23:00:00.000Z", timeZone: NY }, end: { dateTime: "2026-11-03T00:00:00.000Z", timeZone: NY } },
  to: { start: { dateTime: "2026-11-03T00:00:00.000Z", timeZone: NY }, end: { dateTime: "2026-11-03T01:00:00.000Z", timeZone: NY } },
  zone: NY,
});
check("a time set after the clocks change is that hour before it too", rebased.timing.start.dateTime, "2026-10-26T23:00:00.000Z");

check("a split's series from its day, the series' length", timingAtSlot(pivot, breakSeries, SGT), { start: pivot, end: { dateTime: sgt("2026-10-05", "19:00").dateTime, timeZone: SGT } });
check("an all-day split", timingAtSlot({ date: "2027-04-07" }, { start: { date: "2027-04-05" }, end: { date: "2027-04-06" } }, SGT), { start: { date: "2027-04-07" }, end: { date: "2027-04-08" } });

check("a day's place after the series moves", slotAfterShift(pivot, 1, sgt("2026-10-01", "18:30"), SGT).dateTime, sgt("2026-10-06", "18:30").dateTime);
check("an instance's id", instanceId("abc", pivot), "abc_20261005T100000Z");
check("an all-day instance's id", instanceId("abc", { date: "2027-04-07" }), "abc_20270407");
check("a moved day keeps its hour across the change", shiftGoogleTime({ dateTime: "2026-10-30T22:00:00.000Z", timeZone: NY }, 3, NY), { dateTime: "2026-11-02T23:00:00.000Z", timeZone: NY });

/* ─── the days changed on their own ─────────────────────────────────── */

const series = {
  summary: "Break", colorId: undefined, start: breakSeries.start, end: breakSeries.end,
  extendedProperties: { private: { anotherAppTag: "keep" } },
};
const renamed = { summary: "Gym - Chris", status: "confirmed", originalStartTime: pivot, start: pivot, end: { dateTime: sgt("2026-10-05", "19:00").dateTime, timeZone: SGT }, extendedProperties: { private: { anotherAppTag: "keep" } } };
let plan = exceptionPlan(renamed, series, SGT);
check("a renamed day: its name, nothing else", [plan.fields, plan.privateFields, plan.moved, plan.cancelled], [{ summary: "Gym - Chris" }, {}, null, false]);

plan = exceptionPlan({ ...renamed, summary: "Break", colorId: "11", extendedProperties: { private: { anotherAppTag: "keep", croncalType: "work" } } }, series, SGT);
check("a coloured and typed day", [plan.fields, plan.privateFields], [{ colorId: "11" }, { croncalType: "work" }]);

plan = exceptionPlan({ ...renamed, summary: "Break", extendedProperties: {} }, { ...series, colorId: "5" }, SGT);
check("a day that lost the series' colour and tag", [plan.fields, plan.privateFields], [{ colorId: null }, { anotherAppTag: null }]);

plan = exceptionPlan({ ...renamed, start: sgt("2026-10-05", "20:00"), end: sgt("2026-10-05", "21:00") }, series, SGT);
check("a moved day", plan.moved?.start.dateTime, sgt("2026-10-05", "20:00").dateTime);
plan = exceptionPlan({ ...renamed, summary: "Break", end: sgt("2026-10-05", "19:30") }, series, SGT);
check("a longer day is moved too", Boolean(plan.moved), true);
check("a deleted day", exceptionPlan({ status: "cancelled", originalStartTime: pivot }, series, SGT).cancelled, true);
check("no original start, no plan", exceptionPlan({ summary: "x" }, series, SGT), null);

const movedPlan = exceptionPlan({ ...renamed, start: sgt("2026-10-05", "20:00"), end: sgt("2026-10-05", "21:00"), colorId: "11" }, series, SGT);
check("restored whole", restoreBody(movedPlan, { changed: new Set(), dayShift: 0, keepMove: true, seriesAllDay: false, zone: SGT }), {
  summary: "Gym - Chris", colorId: "11", start: { dateTime: sgt("2026-10-05", "20:00").dateTime, timeZone: SGT }, end: { dateTime: sgt("2026-10-05", "21:00").dateTime, timeZone: SGT },
});
check("a field just set on every day is not given back", Object.keys(restoreBody(movedPlan, { changed: new Set(["colorId", "timing"]), dayShift: 0, keepMove: true, seriesAllDay: false, zone: SGT })), ["summary", "start", "end"]);
check("the move follows a shift in days", restoreBody(movedPlan, { changed: new Set(), dayShift: 1, keepMove: true, seriesAllDay: false, zone: SGT }).start.dateTime, sgt("2026-10-06", "20:00").dateTime);
check("the day whose times were set keeps the form's", "start" in restoreBody(movedPlan, { changed: new Set(), dayShift: 0, keepMove: false, seriesAllDay: false, zone: SGT }), false);
check("a timed move is dropped on an all-day series", "start" in restoreBody(movedPlan, { changed: new Set(), dayShift: 0, keepMove: true, seriesAllDay: true, zone: SGT }), false);
const typedPlan = exceptionPlan({ ...renamed, extendedProperties: { private: { anotherAppTag: "keep", croncalType: "work", croncalImportance: "high" } } }, series, SGT);
check("a private field just set is not given back", restoreBody(typedPlan, { changed: new Set(["private:croncalType"]), dayShift: 0, keepMove: true, seriesAllDay: false, zone: SGT }).extendedProperties, { private: { croncalImportance: "high" } });

/* ─── what the form's save sends ────────────────────────────────────── */

const gym = mapGoogleEvent({
  id: "a1_20261005T100000Z", recurringEventId: "a1", summary: "Gym - Chris",
  start: { dateTime: "2026-10-05T18:00:00+08:00", timeZone: SGT }, end: { dateTime: "2026-10-05T19:00:00+08:00", timeZone: SGT },
  organizer: { self: true },
});
const saved = { ...gym, title: "Gym - Chris", description: null, location: null, participants: null, conferencing: null };
check("the bug: colour, type and importance are a change", buildGoogleEventPatch({ ...saved, color: "#D50000", importance: "high", event_type: "personal" }, gym), { color: "#D50000", importance: "high", event_type: "personal" });
check("nothing changed sends nothing", buildGoogleEventPatch({ ...saved, start_time: new Date(gym.start_time).toISOString(), end_time: new Date(gym.end_time).toISOString() }, gym), {});
check("a stray space is not a rename", buildGoogleEventPatch({ title: "Gym - Chris" }, { ...gym, title: "Gym - Chris " }), {});
check("a colour in other case is the same colour", buildGoogleEventPatch({ color: "#4285f4" }, gym), {});
check("choosing neither importance is a change", buildGoogleEventPatch({ importance: null }, { ...gym, importance: "high" }), { importance: null });
check("a link typed", buildGoogleEventPatch({ conferencing: "https://meet.example/x" }, gym), { link: "https://meet.example/x" });
check("a link cleared", buildGoogleEventPatch({ conferencing: null }, { ...gym, conferencing: "https://meet.example/x" }), { link: null });
check("a repeat changed", buildGoogleEventPatch({ google: { ...gym.google, repeat: "weekly" } }, { ...gym, google: { ...gym.google, repeat: "weekdays" } }), { repeat: "weekly" });
check("a custom repeat left alone", buildGoogleEventPatch({ google: { ...gym.google, repeat: "custom" } }, { ...gym, google: { ...gym.google, repeat: "custom" } }), {});
check("a repeat never read is never sent", buildGoogleEventPatch({ google: { ...gym.google, repeat: "weekly" } }, gym), {});
check("a move sends all four times", buildGoogleEventPatch({ start_time: "2026-10-05T10:30:00.000Z", end_time: "2026-10-05T11:30:00.000Z" }, gym), {
  start_time: "2026-10-05T10:30:00.000Z", end_time: "2026-10-05T11:30:00.000Z", all_day: false, timezone: SGT,
});
check("a new zone on a timed event is a change", Object.keys(buildGoogleEventPatch({ timezone: NY }, gym)).sort(), ["all_day", "end_time", "start_time", "timezone"]);
const holiday = { ...gym, all_day: true, start_time: "2026-10-03T00:00:00", end_time: "2026-10-03T23:59:59", timezone: NY };
check("an all-day event read in this device's zone is not moved", buildGoogleEventPatch({ timezone: SGT, all_day: true, start_time: holiday.start_time, end_time: holiday.end_time }, holiday), {});

/* ─── what reaches Google ───────────────────────────────────────────── */

check("Google's colour ids", [googleColorId("#D50000"), googleColorId("#33b679"), googleColorId("#4285F4"), googleColorId(null)], ["11", "2", null, null]);
const fields = googleEventFields({ title: "", description: null, location: null, color: "#0B8043", importance: "high", event_type: null, link: null }, []);
check("the body Google gets", fields, {
  summary: "(No title)", description: "", location: "", colorId: "10",
  extendedProperties: { private: { croncalImportance: "high", croncalType: null, croncalLink: "" } },
});
check("a colour Google cannot carry is not sent", googleEventFields({ color: "#123456" }, []), {});
check("participants by name keep their address", googleEventFields({ participants: "Ann" }, [{ email: "ann@x.com", displayName: "Ann" }]).attendees, [{ email: "ann@x.com", displayName: "Ann" }]);
check("the fields a save sets, by name", [...changedFieldKeys(fields, { title: "", start_time: "x", end_time: "y", all_day: false, timezone: SGT })].sort(), [
  "colorId", "description", "location", "private:croncalImportance", "private:croncalLink", "private:croncalType", "summary", "timing",
]);

/* ─── what CronCal reads back ─────────────────────────────────────────── */

check("a Google day knows its series", [gym.google.seriesId, gym.google.canSplit, gym.google.repeat], ["a1", true, undefined]);
check("a one-off does not repeat", mapGoogleEvent({ id: "x", start: { dateTime: "2026-10-05T10:00:00Z" }, end: { dateTime: "2026-10-05T11:00:00Z" } }).google, { seriesId: null, canSplit: false, repeat: "none" });
const typed = mapGoogleEvent({
  id: "y", summary: "Call", start: { dateTime: "2026-10-05T10:00:00Z" }, end: { dateTime: "2026-10-05T11:00:00Z" },
  colorId: "11", hangoutLink: "https://meet.google.com/abc", organizer: { self: false },
  extendedProperties: { private: { croncalImportance: "high", croncalType: "work" } },
});
check("type, importance and colour read back", [typed.color, typed.importance, typed.event_type, typed.conferencing, typed.google.canSplit], ["#D50000", "high", "work", "https://meet.google.com/abc", false]);
check("a link typed in CronCal wins", mapGoogleEvent({ ...typed, id: "y", extendedProperties: { private: { croncalLink: "https://x.test" } } }).conferencing, "https://x.test");
check("a link cleared in CronCal stays cleared", mapGoogleEvent({ ...typed, id: "y", extendedProperties: { private: { croncalLink: "" } } }).conferencing, null);
check("a value CronCal does not know is none", mapGoogleEvent({ ...typed, id: "y", extendedProperties: { private: { croncalImportance: "urgent", croncalType: "Work" } } }).importance, null);
check("an out-of-office day cannot be split", mapGoogleEvent({ ...typed, id: "y", organizer: { self: true }, eventType: "outOfOffice" }).google.canSplit, false);

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`google recurrence: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`google recurrence: ${passed} passed`);
