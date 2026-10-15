/**
 * Cases for the browser's check on the Google events response. No framework:
 * `npm test -- google-events-response`.
 *
 * What is being defended is the calendar page: an unexpected shape used to
 * reach a `for...of`, throw inside a state update and replace the whole page
 * with the error boundary.
 */

import { parseGoogleEventsResponse } from "@/lib/google-events-response";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${name}: expected ${e}, got ${a}`);
}

const event = (over = {}) => ({
  id: "google_abc", title: "Standup", start_time: "2026-09-26T01:00:00.000Z", end_time: "2026-09-26T02:00:00.000Z",
  all_day: false, source: "google", ...over,
});

check("an empty list is fine", parseGoogleEventsResponse([]), []);
check("a list of events passes through", parseGoogleEventsResponse([event()])?.length, 1);
check("an all-day event with date keys", parseGoogleEventsResponse([event({ start_time: "2026-09-26", end_time: "2026-09-27", all_day: true })])?.length, 1);
check("a zero-length event is allowed", parseGoogleEventsResponse([event({ end_time: "2026-09-26T01:00:00.000Z" })])?.length, 1);

check("an object is refused, the shape that crashed Home", parseGoogleEventsResponse({ events: [] }), null);
check("an error body is refused", parseGoogleEventsResponse({ error: "Reconnect" }), null);
check("null is refused", parseGoogleEventsResponse(null), null);
check("a string is refused", parseGoogleEventsResponse("<html>"), null);
check("a number is refused", parseGoogleEventsResponse(3), null);
check("a non-object entry is refused", parseGoogleEventsResponse([event(), "x"]), null);
check("a nested array entry is refused", parseGoogleEventsResponse([[event()]]), null);
check("no id is refused", parseGoogleEventsResponse([event({ id: undefined })]), null);
check("an empty id is refused", parseGoogleEventsResponse([event({ id: "" })]), null);
check("no title is refused", parseGoogleEventsResponse([event({ title: null })]), null);
check("an unparseable start is refused", parseGoogleEventsResponse([event({ start_time: "soon" })]), null);
check("a missing end is refused", parseGoogleEventsResponse([event({ end_time: undefined })]), null);
check("an end before its start is refused", parseGoogleEventsResponse([event({ end_time: "2026-09-26T00:00:00.000Z" })]), null);
check("a non-boolean all_day is refused", parseGoogleEventsResponse([event({ all_day: "false" })]), null);
check("one bad event refuses the whole answer", parseGoogleEventsResponse([event(), event({ start_time: "" })]), null);

if (failures.length > 0) {
  console.error(`${failures.length} failed, ${passed} passed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`google-events-response: ${passed} passed`);
