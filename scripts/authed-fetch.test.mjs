/**
 * Cases for authedFetch's session handling. `npm run test:authed-fetch`.
 *
 * One bug is worth the whole file: two refreshes running at once. Supabase
 * treats a refresh token spent twice as a stolen token and terminates the
 * session, so the symptom is being signed out while actively using the app —
 * and it only reproduces when two requests 401 in the same tick, which is
 * exactly what opening a panel that mounts two authenticated rows does.
 *
 * Nothing about the code reads as concurrent, which is why the guard had a
 * hole in it for the forced path and nobody saw it.
 */

const { supabase, configureSupabase } = await import("@/lib/supabase");
configureSupabase({ url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_test" });
const { authedFetch } = await import("@/lib/authed-fetch");
const { SESSION_ERROR_CODE } = await import("@/lib/session-error");

const failures = [];
let passed = 0;

function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    return;
  }
  failures.push(`  ${name}\n      got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A session that is nowhere near expiry, so only a *forced* refresh fires. */
function freshSession(token) {
  return {
    access_token: token,
    refresh_token: `refresh-${token}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: "u1", user_metadata: { brand_access: true } },
  };
}

/**
 * Release the first `n` callers together.
 *
 * Without this the two requests run a few microtasks apart, the first refresh
 * finishes before the second starts, and the race never appears — a version
 * of this test without the barrier passed against the very bug it was written
 * for. The real page fires both from effects in the same commit, so arriving
 * together is the honest simulation, not a contrivance.
 */
function barrier(n) {
  let arrived = 0;
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  return async () => {
    if (++arrived >= n) release();
    await gate;
  };
}

/**
 * Install stubs and return the counters.
 *
 * `concurrent` is the whole point: it records the high-water mark of refreshes
 * in flight simultaneously. Anything above 1 is the bug.
 */
function install({ unauthorizedFirstCall = true, holdUntil = 0 } = {}) {
  const gate = holdUntil > 0 ? barrier(holdUntil) : null;
  const state = { refreshes: 0, inFlight: 0, concurrent: 0, sends: 0, tokenSeq: 0 };
  let current = freshSession("token-0");

  supabase.auth.getSession = async () => ({ data: { session: current }, error: null });

  supabase.auth.refreshSession = async () => {
    state.refreshes += 1;
    state.inFlight += 1;
    state.concurrent = Math.max(state.concurrent, state.inFlight);
    // A real refresh is a network round trip; without a gap here two
    // overlapping calls would still look sequential.
    await sleep(25);
    state.inFlight -= 1;
    state.tokenSeq += 1;
    current = freshSession(`token-${state.tokenSeq}`);
    return { data: { session: current }, error: null };
  };

  globalThis.fetch = async (_input, init) => {
    state.sends += 1;
    const token = new Headers(init?.headers).get("authorization");
    // Every request on the original token is rejected the way a server whose
    // session has gone stale rejects it: 401 carrying the session code.
    if (unauthorizedFirstCall && token === "Bearer token-0") {
      if (gate) await gate();
      return new Response(JSON.stringify({ error: "expired", code: SESSION_ERROR_CODE }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  return state;
}

/* ── the bug: two 401s in the same tick ──────────────────────────────────── */

{
  const state = install({ holdUntil: 2 });
  // What opening Settings does: two rows mount and each calls its own endpoint.
  const [a, b] = await Promise.all([authedFetch("/api/goals"), authedFetch("/api/tasks")]);

  check("two simultaneous 401s never refresh concurrently", state.concurrent, 1);
  check("…and only one refresh is spent between them", state.refreshes, 1);
  check("both requests succeed after the retry", [a.status, b.status], [200, 200]);
}

/* ── an unforced refresh already running when a forced one arrives ───────── */

{
  const state = install();
  // The first call warms `pending` with an unforced resolve; the second forces
  // one while that is still in flight. They must not overlap.
  const first = authedFetch("/api/one");
  await sleep(5);
  const second = authedFetch("/api/two");
  await Promise.all([first, second]);

  check("a forced refresh queues behind an unforced one", state.concurrent, 1);
}

/* ── the ordinary paths still behave ─────────────────────────────────────── */

{
  const state = install({ unauthorizedFirstCall: false });
  const response = await authedFetch("/api/fine");

  check("a request that is not rejected never refreshes", state.refreshes, 0);
  check("…and is sent exactly once", state.sends, 1);
  check("…and returns its response", response.status, 200);
}

{
  // A 401 that is not about the session — a disconnected Google account — must
  // not trigger a refresh or a retry, or every request made while Google is
  // unlinked doubles.
  const state = install({ unauthorizedFirstCall: false });
  globalThis.fetch = async () => {
    state.sends += 1;
    return new Response(JSON.stringify({ error: "Google is disconnected." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await authedFetch("/api/settings");
  check("a 401 without the session code is not retried", state.sends, 1);
  check("…and is handed back as-is", response.status, 401);
  check("…and does not refresh", state.refreshes, 0);
}

{
  // No session at all is a thrown error, not a silent unauthenticated request.
  install();
  supabase.auth.getSession = async () => ({ data: { session: null }, error: null });

  let threw = "";
  try {
    await authedFetch("/api/anything");
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("no session throws rather than sending", threw, "You must sign in before using this feature.");
}

if (failures.length) {
  console.error("\n" + failures.join("\n"));
  console.error(`\n  ${passed} passed, ${failures.length} FAILED\n`);
  process.exit(1);
}
console.log(`\n  ${passed} passed, 0 failed\n`);
