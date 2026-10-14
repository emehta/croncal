/**
 * The guard in front of a copy on someone's computer (src/proxy.ts).
 *
 * A mistake here is silent until it is a loop or a hole: a redirect between
 * loopback names that Next cut down to a bare path reloaded forever,
 * and a guard that let another site's form post through would let any page
 * the user visits write to their CronCal.
 */

import { NextRequest } from "next/server.js";
import { proxy } from "@/proxy";

const failures = [];
let passed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
}

delete process.env.VERCEL;

function request(url, { method = "GET", host, headers = {} } = {}) {
  const parsed = new URL(url);
  return new NextRequest(url, { method, headers: { host: host ?? parsed.host, ...headers } });
}
const passes = (response) => response.headers.get("x-middleware-next") === "1";

const moved = async (response) => {
  const body = await response.text();
  return { status: response.status, location: response.headers.get("location"), to: body.match(/location\.replace\("([^"]+)"\)/)?.[1] ?? null };
};
check("a page on 127.0.0.1 moves to localhost, same port, path and query, with no HTTP redirect for Next to rewrite",
  await moved(proxy(request("http://127.0.0.1:3102/calendar?task=1&x=2"))), { status: 200, location: null, to: "http://localhost:3102/calendar?task=1&x=2" });
check("a page on [::1] moves to localhost", (await moved(proxy(request("http://[::1]:3102/calendar")))).to, "http://localhost:3102/calendar");
check("npm start's health check on 127.0.0.1 is answered where it is", passes(proxy(request("http://127.0.0.1:3102/api/health"))), true);
check("the app's files on 127.0.0.1 are served where they are", passes(proxy(request("http://127.0.0.1:3102/_next/static/x.js"))), true);
check("an address with a quote cannot break out of the page", (await moved(proxy(request('http://127.0.0.1:3102/a"b<c')))).to?.includes("<"), false);

check("localhost is let through", passes(proxy(request("http://localhost:3102/calendar"))), true);
check("a foreign Host (DNS rebinding) is refused", proxy(request("http://localhost:3102/calendar", { host: "attacker.example:3102" })).status, 421);

const write = (headers) => proxy(request("http://localhost:3102/api/selfhost/account", { method: "POST", headers }));
const own = { origin: "http://localhost:3102", "sec-fetch-site": "same-origin", "content-type": "application/json" };
check("the app's own JSON write goes through", passes(write(own)), true);
check("another site's write is refused", write({ ...own, origin: "https://attacker.example", "sec-fetch-site": "cross-site" }).status, 403);
check("a write with no Origin is refused", write({ "content-type": "application/json" }).status, 403);
check("a write from 127.0.0.1's origin to localhost is refused", write({ ...own, origin: "http://127.0.0.1:3102" }).status, 403);
check("a cross-site form post dressed as text/plain is refused", write({ ...own, "content-type": "text/plain" }).status, 415);
check("same origin but the browser says cross-site is refused", write({ ...own, "sec-fetch-site": "cross-site" }).status, 403);

process.env.VERCEL = "1";
check("a copy on the web is left to its own domain", passes(proxy(request("https://croncal.example/calendar", { host: "croncal.example" }))), true);
delete process.env.VERCEL;

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`proxy: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`proxy: ${passed} passed`);
