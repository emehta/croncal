/**
 * Saving a change to a repeating event: `npm test -- series-edit`.
 *
 * The form opens on the day that was clicked, and only Save asks which days
 * the change is for (the owner's order, 5 Oct 2026). What is defended: a
 * question offered with a choice that cannot work (one day taking a repeat of
 * its own, a series someone else organises split in two), a question asked
 * when nothing changed, and a CronCal series changed for all its days from a
 * day in the middle, which must move by as much as that day did rather than
 * to it, taking its skipped and changed days along.
 */

import {
  SCOPE_LABELS,
  changedRowFields,
  dayTimesChanged,
  eventChanges,
  placeOfChangedDay,
  planAllDaysEdit,
  planFollowingEdit,
  planSeriesMove,
  scopeOptions,
  splitExceptionStarts,
} from "@/lib/series-edit";
import { zonedDateTimeToUtc } from "@/lib/calendar-timezone";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SGT = "Asia/Singapore";
const NY = "America/New_York";
const at = (date, time, zone = SGT) => zonedDateTimeToUtc(date, time, zone).toISOString();

/* ─── which days a change can be for ────────────────────────────────── */

const ownSeries = { source: "croncal", recurrence: "weekly" };
const googleDay = { source: "google", google: { seriesId: "a1", canSplit: true } };
const invite = { source: "google", google: { seriesId: "c3", canSplit: false } };
check("a CronCal series: all three", scopeOptions(ownSeries, false), ["single", "following", "all"]);
check("a Google series day: all three", scopeOptions(googleDay, false), ["single", "following", "all"]);
check("a new repeat cannot be for one day", scopeOptions(googleDay, true), ["following", "all"]);
check("someone else's series cannot be split", scopeOptions(invite, false), ["single", "all"]);
check("a new repeat on someone else's series: all days only", scopeOptions(invite, true), ["all"]);
check("the labels", Object.values(SCOPE_LABELS), ["This event", "This and following events", "All events"]);
check("no label has a dash", Object.values(SCOPE_LABELS).some((label) => /[\u2013\u2014]/.test(label)), false);

/* ─── what a save changed ───────────────────────────────────────────── */

const day = {
  id: "s1", source: "croncal", title: "Gym", description: null, location: null, participants: null, conferencing: null,
  color: "#33B679", importance: "medium", event_type: "personal", recurrence: "weekly",
  start_time: at("2026-10-05", "09:00"), end_time: at("2026-10-05", "10:00"), all_day: false, timezone: SGT,
};
const saved = { ...day };
delete saved.id; delete saved.source;
check("nothing changed: nothing to ask", eventChanges(saved, day), {});
check("importance chosen as none", eventChanges({ ...saved, importance: null }, day), { importance: null });
check("a new repeat", eventChanges({ ...saved, recurrence: "daily" }, day), { repeat: "daily" });
check("no longer repeating", eventChanges({ ...saved, recurrence: null }, day), { repeat: "none" });
check("a new colour", eventChanges({ ...saved, color: "#D50000" }, day), { color: "#D50000" });
check("moved an hour", Object.keys(eventChanges({ ...saved, start_time: at("2026-10-05", "10:00"), end_time: at("2026-10-05", "11:00") }, day)).sort(), ["all_day", "end_time", "start_time", "timezone"]);
const google = { ...day, source: "google", recurrence: null, google: { seriesId: "a1", canSplit: true, repeat: "weekdays" } };
check("a Google day's colour", eventChanges({ ...saved, recurrence: null, color: "#D50000", google: google.google }, google), { color: "#D50000" });
check("a Google day's repeat", eventChanges({ ...saved, recurrence: null, google: { ...google.google, repeat: "weekly" } }, google), { repeat: "weekly" });

check("the fields carried to the changed days", changedRowFields({ ...saved, title: "Gym with Coach", conferencing: "https://x.test" }, day), { title: "Gym with Coach", conferencing: "https://x.test" });
check("none carried when only the time moved", changedRowFields({ ...saved, start_time: at("2026-10-05", "10:00") }, day), {});

const shownDay = { start: new Date(day.start_time), end: new Date(day.end_time) };
check("the same times: not moved", dayTimesChanged(shownDay, day, saved), false);
check("an hour later: moved", dayTimesChanged(shownDay, day, { ...saved, start_time: at("2026-10-05", "10:00") }), true);
check("a timed day in a new zone: moved", dayTimesChanged(shownDay, day, { ...saved, timezone: NY }), true);
check("an all-day day in a new zone: not moved", dayTimesChanged(shownDay, { ...day, all_day: true }, { ...saved, all_day: true, timezone: NY }), false);

/* ─── a CronCal series, changed for all its days ──────────────────────── */

// Every Monday 09:00 to 10:00 in Singapore from 7 Sep. 14 Sep skipped,
// 21 Sep changed but at its place, 28 Sep moved on its own to 15:00.
const series = {
  ...day, start_time: at("2026-09-07", "09:00"), end_time: at("2026-09-07", "10:00"),
  recurrence_exceptions: [at("2026-09-14", "09:00")],
};
const overrides = [
  { id: "o21", original_occurrence_start: at("2026-09-21", "09:00"), start_time: at("2026-09-21", "09:00"), end_time: at("2026-09-21", "10:00"), all_day: false, timezone: SGT },
  { id: "o28", original_occurrence_start: at("2026-09-28", "09:00"), start_time: at("2026-09-28", "15:00"), end_time: at("2026-09-28", "16:00"), all_day: false, timezone: SGT },
];

let plan = planSeriesMove(series, shownDay, { ...saved, start_time: at("2026-10-05", "10:00"), end_time: at("2026-10-05", "11:00") }, overrides);
check("an hour later on 5 Oct: the series starts at 10:00 on 7 Sep", [plan.start_time, plan.end_time], [at("2026-09-07", "10:00"), at("2026-09-07", "11:00")]);
check("the skipped day stays skipped, at its new hour", plan.recurrence_exceptions, [at("2026-09-14", "10:00")]);
check("a changed day at its place goes with the series", plan.overrides[0], { id: "o21", original_occurrence_start: at("2026-09-21", "10:00"), start_time: at("2026-09-21", "10:00"), end_time: at("2026-09-21", "11:00") });
check("a day moved on its own keeps its own hour", plan.overrides[1], { id: "o28", original_occurrence_start: at("2026-09-28", "10:00"), start_time: at("2026-09-28", "15:00"), end_time: at("2026-09-28", "16:00") });

plan = planSeriesMove(series, shownDay, { ...saved, start_time: at("2026-10-06", "09:00"), end_time: at("2026-10-06", "11:00") }, overrides);
check("to Tuesday and longer: from Tuesday 8 Sep", [plan.start_time, plan.end_time], [at("2026-09-08", "09:00"), at("2026-09-08", "11:00")]);
check("every skipped and changed day a day on", [plan.recurrence_exceptions[0], plan.overrides[0].original_occurrence_start, plan.overrides[0].end_time, plan.overrides[1].start_time], [at("2026-09-15", "09:00"), at("2026-09-22", "09:00"), at("2026-09-22", "11:00"), at("2026-09-29", "15:00")]);

plan = planSeriesMove(series, shownDay, { ...saved, all_day: true, start_time: at("2026-10-05", "00:00"), end_time: zonedDateTimeToUtc("2026-10-05", "23:59", SGT, 59).toISOString() }, []);
check("made all-day: 7 Sep, all of it", [plan.start_time, plan.end_time], [at("2026-09-07", "00:00"), zonedDateTimeToUtc("2026-09-07", "23:59", SGT, 59).toISOString()]);
check("its skipped day is the whole day", plan.recurrence_exceptions, [at("2026-09-14", "00:00")]);

plan = planSeriesMove(series, shownDay, { ...saved, timezone: NY }, overrides);
check("a new zone alone moves nothing", [plan.start_time, plan.recurrence_exceptions[0], plan.overrides[0].start_time], [series.start_time, at("2026-09-14", "09:00"), at("2026-09-21", "09:00")]);

// New York's clocks go back on 1 Nov: a series begun in October, set to 19:00 from a day in November, is 19:00 in October too.
const nySeries = { ...day, timezone: NY, start_time: at("2026-10-19", "18:00", NY), end_time: at("2026-10-19", "19:00", NY), recurrence_exceptions: [] };
plan = planSeriesMove(nySeries, { start: new Date(at("2026-11-02", "18:00", NY)), end: new Date(at("2026-11-02", "19:00", NY)) },
  { ...saved, timezone: NY, start_time: at("2026-11-02", "19:00", NY), end_time: at("2026-11-02", "20:00", NY) }, []);
check("an hour set after the clocks change is that hour before it", plan.start_time, at("2026-10-19", "19:00", NY));

/* ─── a CronCal series changed from one day on ────────────────────────── */

// The series above, from 5 Oct: 14 Sep skipped (before), 12 Oct skipped (after),
// 19 Oct changed at its place, 26 Oct moved on its own to 15:00.
const long = { ...series, recurrence_exceptions: [at("2026-09-14", "09:00"), at("2026-10-12", "09:00")] };
const later = [
  { ...day, id: "o19", recurrence: null, title: "Gym 19", original_occurrence_start: at("2026-10-19", "09:00"), start_time: at("2026-10-19", "09:00"), end_time: at("2026-10-19", "10:00") },
  { ...day, id: "o26", recurrence: null, title: "Gym 26", original_occurrence_start: at("2026-10-26", "09:00"), start_time: at("2026-10-26", "15:00"), end_time: at("2026-10-26", "16:00") },
  { ...day, id: "o28s", recurrence: null, original_occurrence_start: at("2026-09-28", "09:00"), start_time: at("2026-09-28", "15:00"), end_time: at("2026-09-28", "16:00") },
];
const oct5 = { start: new Date(day.start_time), end: new Date(day.end_time) };
const shown5 = { ...long, start_time: day.start_time, end_time: day.end_time };

let following = planFollowingEdit(long, oct5, shown5, { ...saved, recurrence: null }, later);
check("Does not repeat, from a day: one event, the form's, with no rule", [following.next.recurrence, following.next.recurrence_until, following.next.recurrence_exceptions, following.next.start_time], [null, null, [], day.start_time]);
check("…and the changed days after it go", following.days, []);

following = planFollowingEdit(long, oct5, shown5, { ...saved, title: "Gym later", start_time: at("2026-10-05", "10:00"), end_time: at("2026-10-05", "11:00") }, later);
check("an hour later from 5 Oct: the new series starts there, at 10:00", [following.next.start_time, following.next.end_time, following.next.recurrence, following.next.title], [at("2026-10-05", "10:00"), at("2026-10-05", "11:00"), "weekly", "Gym later"]);
check("…its skipped day moves to the new hour, and the one before 5 Oct stays with the old series", following.next.recurrence_exceptions, [at("2026-10-12", "10:00")]);
check("…its changed days move as for all days, keeping their own changes",
  following.days.map((d) => [d.id, d.fields.original_occurrence_start, d.fields.start_time, d.fields.title]),
  [["o19", at("2026-10-19", "10:00"), at("2026-10-19", "10:00"), undefined], ["o26", at("2026-10-26", "10:00"), at("2026-10-26", "15:00"), undefined]]);

following = planFollowingEdit(long, oct5, shown5, { ...saved, title: "Gym renamed" }, later);
check("only renamed: the new series from 5 Oct, its days where they were",
  [following.next.start_time, following.next.recurrence_exceptions, following.days.map((d) => d.fields)], [day.start_time, [at("2026-10-12", "09:00")], [{}, {}]]);

const noRule = { ...saved, title: "Gym renamed" };
delete noRule.recurrence;
check("a change that says nothing of the repeat keeps it", planFollowingEdit(long, oct5, shown5, noRule, later).next.recurrence, "weekly");
following = planFollowingEdit(long, oct5, shown5, { ...saved, recurrence: "daily" }, later);
check("a new rule starts with no skipped or changed days", [following.next.recurrence, following.next.recurrence_exceptions, following.days], ["daily", [], []]);

/* ─── a day changed on its own is still a day of its series ───────────── */

const o26 = later[1];
check("a changed day's place is the day it took over, at the series' times", placeOfChangedDay(long, o26), { start: new Date(at("2026-10-26", "09:00")), end: new Date(at("2026-10-26", "10:00")) });
const shown26 = { ...o26, recurrence: "weekly" };
let all = planAllDaysEdit(long, shown26, { ...shown26, location: "Pool" }, later);
check("opened on a day moved on its own, a new location for all days moves nothing", [all.fields, all.dropDays], [{ location: "Pool", recurrence: "weekly" }, false]);
check("…and goes to the changed days too, which keep their own times", all.days.map((d) => d.fields), [{ location: "Pool" }, { location: "Pool" }, { location: "Pool" }]);
all = planAllDaysEdit(long, shown26, { ...shown26, start_time: at("2026-10-26", "16:00"), end_time: at("2026-10-26", "17:00") }, later);
check("…set to 16:00 for all days, the series is at 16:00", [all.fields.start_time, all.fields.recurrence_exceptions], [at("2026-09-07", "16:00"), [at("2026-09-14", "16:00"), at("2026-10-12", "16:00")]]);
check("…and the day it was opened on takes the form's times", all.days.find((d) => d.id === "o26").fields, { original_occurrence_start: at("2026-10-26", "16:00"), start_time: at("2026-10-26", "16:00"), end_time: at("2026-10-26", "17:00"), all_day: false, timezone: SGT });
const ending = { ...long, recurrence_until: at("2026-12-31", "00:00") };
check("a changed day's own end (none) is not taken for the series'", "recurrence_until" in planAllDaysEdit(ending, { ...shown26, recurrence_until: null }, { ...shown26, recurrence_until: null, location: "Pool" }, later).fields, false);
all = planAllDaysEdit(long, { ...shown26, meeting_notes: null }, { ...shown26, meeting_notes: "Bring the agenda" }, later);
check("new notes for all days reach the series, which Google's comparison can't see", all.fields.meeting_notes, "Bring the agenda");
check("…but not the changed days, which keep their own", all.days.every((d) => !("meeting_notes" in d.fields)), true);
check("notes left as they were are not written", "meeting_notes" in planAllDaysEdit(long, shown26, { ...shown26, location: "Pool" }, later).fields, false);
check("from a day on, the new series takes them too", planFollowingEdit(long, oct5, shown5, { ...saved, meeting_notes: "Bring the agenda" }, later).next.meeting_notes, "Bring the agenda");
all = planAllDaysEdit(long, shown26, { ...shown26, recurrence: null }, later);
check("no longer repeating: one event where the form put it, its changed days going", [all.fields.recurrence, all.fields.start_time, all.fields.recurrence_exceptions, all.dropDays], [null, o26.start_time, [], true]);

check("skipped days before a day and from it", splitExceptionStarts([at("2026-10-12", "09:00"), at("2026-09-14", "09:00"), at("2026-10-05", "09:00")], at("2026-10-05", "09:00")),
  { before: [at("2026-09-14", "09:00")], fromPivot: [at("2026-10-05", "09:00"), at("2026-10-12", "09:00")] });

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`series edit: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`series edit: ${passed} passed`);
