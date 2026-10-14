import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { SESSION_ERROR_CODE } from "@/lib/session-error";

/**
 * A fetch that carries the app's session, and takes care that the session it
 * carries is actually usable.
 *
 * This used to be four lines: read getSession(), attach the token, send. The
 * token it read could already be spent — Supabase access tokens last an hour
 * and the browser only refreshes them while the tab is in the foreground — so
 * after a few hours the server would answer "Your session is invalid or
 * expired" and the app looked logged out while holding a perfectly good
 * refresh token.
 */

/*
 * How close to expiry a token has to be before it is refreshed rather than
 * spent. A minute of slack covers a slow request without refreshing on every
 * single call.
 */
const REFRESH_MARGIN_MS = 60_000;

/*
 * One refresh at a time, shared by whoever asks during it.
 *
 * Several of these fire together on a page load — the calendar asks for its
 * Google status while it fetches events — and each used to resolve its own
 * session. Concurrent refreshes spend the same refresh token more than once,
 * which Supabase treats as reuse and answers by ending the session: the exact
 * "logged out while using it" this is meant to stop.
 */
let pending: Promise<Session | null> | null = null;
let pendingForced = false;

function expiringSoon(session: Session): boolean {
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  return expiresAtMs - Date.now() <= REFRESH_MARGIN_MS;
}

async function resolveSession(force: boolean): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  if (!force && !expiringSoon(session)) return session;

  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    // A failed refresh is not proof the token is dead — the network may simply
    // be down. Spend what we have and let the server be the judge.
    return session;
  }
  return data.session ?? session;
}

/**
 * At most one refresh in flight, forced or not.
 *
 * The guard here used to be `if (!force && pending)`, which let a *forced*
 * refresh start alongside one already running — and forced is precisely the
 * path that races. Opening Settings mounts two rows that each call an
 * owner-gated endpoint at the same moment; if the access token is stale both
 * get a 401, both force a refresh, and two `refreshSession()` calls spend the
 * same refresh token. Supabase reads that as a stolen token and terminates the
 * whole session, which is the "logged out while using it" this function was
 * written to prevent, coming in through the one door left open.
 *
 * A forced refresh arriving while an unforced one is running is queued behind
 * it rather than run beside it. Sequential refreshes are safe — each spends
 * the token the previous one returned.
 */
function currentSession(force = false): Promise<Session | null> {
  if (pending && (!force || pendingForced)) return pending;

  const previous = pending;
  const request = (previous ? previous.catch(() => null) : Promise.resolve(null))
    .then(() => resolveSession(force))
    .finally(() => {
      if (pending === request) {
        pending = null;
        pendingForced = false;
      }
    });

  pending = request;
  pendingForced = force;
  return request;
}

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const session = await currentSession();

  if (!session?.access_token) {
    throw new Error("You must sign in before using this feature.");
  }

  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const response = await send(session.access_token);
  if (response.status !== 401) return response;

  /*
   * One retry, and only when the 401 names the session. A disconnected Google
   * account answers 401 too, and retrying that would double every request made
   * while Google is unlinked.
   *
   * Read from a clone so the original body is still intact for the caller when
   * the retry does not happen.
   */
  const body = await response.clone().json().catch(() => null) as { code?: string } | null;
  if (body?.code !== SESSION_ERROR_CODE) return response;

  const refreshed = await currentSession(true);
  if (!refreshed?.access_token || refreshed.access_token === session.access_token) {
    return response;
  }

  return send(refreshed.access_token);
}
