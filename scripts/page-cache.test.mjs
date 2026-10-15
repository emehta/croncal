/**
 * Cases for the calendar's cache of loaded windows: `npm test -- page-cache`.
 *
 * What is being defended is a save that undoes itself. A prefetch of the next
 * month set out, the owner saved a change, the cache was cleared, and then
 * the prefetch landed and put the events from before the save back, which
 * the calendar drew as if the save had not happened.
 */

import {
  cacheGeneration,
  clearPageCache,
  invalidateEventCache,
  isFresh,
  readEventCache,
  writeEventCache,
} from "@/lib/page-cache";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const october = ["2026-09-01T00:00:00.000Z", "2026-11-30T23:59:59.999Z"];
const march = ["2027-02-01T00:00:00.000Z", "2027-04-30T23:59:59.999Z"];
const old = [{ id: "a", title: "Before the save" }];

// A load that lands with nothing changed meanwhile is kept, and fresh.
let startedAt = cacheGeneration();
check("a load with no change meanwhile is kept", writeEventCache("oct", ...october, old, startedAt), true);
check("…and is fresh", isFresh(readEventCache("oct")), true);
check("…for a minute", isFresh(readEventCache("oct"), Date.now() + 61_000), false);

// A load that set out before a change is not.
startedAt = cacheGeneration();
invalidateEventCache({ start_time: "2026-10-05T01:00:00.000Z", end_time: "2026-10-05T02:00:00.000Z", recurrence: null });
check("a change drops the windows it touches", readEventCache("oct"), undefined);
check("a load that set out before it does not put the old events back", writeEventCache("oct", ...october, old, startedAt), false);
check("…so the window stays empty for the next load", readEventCache("oct"), undefined);
check("a load that set out after it is kept", writeEventCache("oct", ...october, [], cacheGeneration()), true);

// A one-off change leaves the windows it does not touch; a series' clears them all.
writeEventCache("mar", ...march, old, cacheGeneration());
invalidateEventCache({ start_time: "2026-10-05T01:00:00.000Z", end_time: "2026-10-05T02:00:00.000Z" });
check("a one-off in October leaves March", [readEventCache("oct"), Boolean(readEventCache("mar"))], [undefined, true]);
invalidateEventCache({ start_time: "2026-10-05T01:00:00.000Z", end_time: "2026-10-05T02:00:00.000Z", recurrence: "weekly" });
check("a series, which runs through every month, clears them all", readEventCache("mar"), undefined);
writeEventCache("mar", ...march, old, cacheGeneration());
invalidateEventCache();
check("so does a change with no times", readEventCache("mar"), undefined);

// Signing out empties it, and a load from before is not kept.
startedAt = cacheGeneration();
writeEventCache("mar", ...march, old, startedAt);
clearPageCache();
check("signing out empties it", readEventCache("mar"), undefined);
check("…and a load from before cannot fill it again", writeEventCache("mar", ...march, old, startedAt), false);

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`page-cache: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`page-cache: ${passed} passed`);
