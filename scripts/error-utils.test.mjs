/**
 * What a failed save says in its banner. Offline, Supabase's client hands
 * back "TypeError: Failed to fetch" with a stack trace as its details, and
 * the banner showed all of it; it says so in words now.
 */

import { OFFLINE_MESSAGE, getErrorMessage, isAbortError, isNetworkError } from "@/lib/error-utils";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

const postgrestOffline = { message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch\n    at fetch (main.js:1:2)\n    at …", hint: "", code: "" };
check("Supabase offline in Chrome is a plain sentence", getErrorMessage(postgrestOffline, "fallback"), OFFLINE_MESSAGE);
check("Safari's words for it", getErrorMessage(new TypeError("Load failed"), "fallback"), OFFLINE_MESSAGE);
check("Firefox's words for it", getErrorMessage(new TypeError("NetworkError when attempting to fetch resource."), "fallback"), OFFLINE_MESSAGE);
check("and it counts as a network error", isNetworkError(postgrestOffline), true);
check("a real database error keeps its own words", getErrorMessage({ message: "new row violates row-level security policy", code: "42501" }, "fallback"), "new row violates row-level security policy Code: 42501");
check("a database error is not a network error", isNetworkError({ message: "duplicate key value" }), false);
check("an Error's message", getErrorMessage(new Error("Could not save."), "fallback"), "Could not save.");
check("nothing useful gives the fallback", getErrorMessage({}, "Could not load that."), "Could not load that.");
check("a string error gives the fallback", getErrorMessage("boom", "fallback"), "fallback");
check("an abort is an abort", isAbortError(new DOMException("aborted", "AbortError")), true);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`error-utils: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`error-utils: ${passed} passed`);
