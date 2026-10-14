import { NextResponse, type NextRequest } from "next/server";
import { getGoogleAccessTokenState } from "@/lib/google-auth";
import { AuthAccessError, requireAuthenticatedRequest } from "@/lib/owner";
import { SESSION_ERROR_CODE } from "@/lib/session-error";
import { resolveGoogleRedirectUri } from "@/lib/google-redirect-uri";
import { SetupError } from "@/selfhost/server";

/**
 * Shared plumbing for the route handlers.
 *
 * Every handler used to repeat the same two blocks verbatim: a try/catch that
 * maps `AuthAccessError` to its status and everything else to a logged 500, and
 * — in the five Google Calendar routes — a 25-line token-state ladder. Both are
 * here once so a handler reads as the thing it actually does.
 */

/**
 * Map a thrown error to a JSON response.
 *
 * `AuthAccessError` carries its own status and a message meant for the user;
 * anything else is unexpected, so it is logged server-side and the caller gets
 * `fallbackMessage` rather than an internal detail.
 *
 * The session errors also carry a code, so `authedFetch` can tell a stale
 * login token — worth one retry on a fresh one — from a 401 about a connected
 * service, which is never worth retrying.
 */
export function handleRouteError(
  error: unknown,
  label: string,
  fallbackMessage: string,
): NextResponse {
  if (error instanceof AuthAccessError) {
    // Only a 401 is a session worth refreshing; a 403 or a missing project is not.
    return NextResponse.json(
      error.status === 401 ? { error: error.message, code: SESSION_ERROR_CODE } : { error: error.message },
      { status: error.status },
    );
  }
  // The project's settings can't be read, or none is connected: said as it is.
  if (error instanceof SetupError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(`${label}:`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

/**
 * The request body as a JSON object, or null when it is missing, malformed or
 * not an object. A bare `await request.json()` threw on a bad body, and the
 * route's catch-all answered a client mistake with a 500.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** A 400 for a request body that is not what the route expects. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Parse a query-string integer, falling back and clamping to a safe range. */
export function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

type GoogleAccessTokenResult =
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse };

/**
 * Authenticate the caller and resolve a usable Google access token.
 *
 * Returns either a token or the exact response the caller should send back. The
 * statuses matter and are deliberately distinct: a revoked grant is a 401 that
 * asks the user to reconnect, while a transient refresh failure is a 503 so a
 * retry is the obvious next step instead of a spurious "reconnect" prompt.
 */
export async function requireGoogleAccessToken(
  request: Request,
): Promise<GoogleAccessTokenResult> {
  let userId: string;

  try {
    const user = await requireAuthenticatedRequest(request);
    userId = user.id;
  } catch (error) {
    return {
      ok: false,
      response: handleRouteError(error, "Google route session check", "Could not verify your session."),
    };
  }

  const tokenState = await getGoogleAccessTokenState(userId);

  if (tokenState.status === "missing_auth") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Google Calendar is disconnected or needs to be reconnected." },
        { status: 401 },
      ),
    };
  }

  if (tokenState.status === "reconnect_required") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Reconnect Google Calendar in Settings to restore access." },
        { status: 401 },
      ),
    };
  }

  if (tokenState.status === "temporary_failure" || !tokenState.accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Google Calendar is temporarily unavailable. Try again in a moment." },
        { status: 503 },
      ),
    };
  }

  return { ok: true, userId, accessToken: tokenState.accessToken };
}

/**
 * The OAuth callback URL.
 *
 * Google requires the value sent when starting the flow to match the value sent
 * when exchanging the code *exactly*, so both sides resolve it here.
 *
 * The request's own origin wins over GOOGLE_REDIRECT_URI whenever the two
 * disagree. A stale value in that variable used to be silent and fatal: after
 * the site moved domains it still pointed at the old one, so Google named the
 * old host on its consent screen and then returned the user to a domain that
 * no longer served the callback — a Vercel 404 at the end of a successful
 * sign-in, with nothing to indicate why. The variable is still honoured when it
 * agrees with the request, which is the case it exists for (a proxy in front of
 * the app), and the mismatch is logged rather than swallowed.
 */
export function getGoogleRedirectUri(request: NextRequest): string {
  const { uri, warning } = resolveGoogleRedirectUri(
    process.env.GOOGLE_REDIRECT_URI,
    request.nextUrl.origin,
  );
  if (warning) console.warn(warning);
  return uri;
}
