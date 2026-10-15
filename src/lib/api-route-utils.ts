import { NextResponse, type NextRequest } from "next/server";
import { getGoogleAccessTokenState } from "@/lib/google-auth";
import { GOOGLE_RECONNECT_MESSAGE } from "@/lib/google-calendar";
import { requireAuthenticatedRequest } from "@/lib/owner";
import { resolveGoogleRedirectUri } from "@/lib/google-redirect-uri";
import { fail, fromError } from "@/selfhost/http";
import { SetupError } from "@/selfhost/server";

/**
 * Plumbing for the Google routes, beside the setup routes' own in
 * selfhost/http, which these use where they overlap: the catch-all that maps
 * a thrown error to its answer, and the token-state ladder. Both are here once
 * so a handler reads as the thing it actually does.
 */

/**
 * Map a thrown error to a JSON response.
 *
 * A SetupError (the session, the owner flag, a project not connected) carries
 * its own status and words, and a session that ended also its code, so
 * `authedFetch` can tell a stale login token (worth one retry on a fresh one)
 * from a 401 about a connected service. Anything else is unexpected, so it is
 * logged here and the caller gets `fallbackMessage` rather than an internal
 * detail.
 */
export function handleRouteError(
  error: unknown,
  label: string,
  fallbackMessage: string,
): NextResponse {
  if (error instanceof SetupError) return fromError(error);
  console.error(`${label}:`, error);
  return fail(fallbackMessage, 500);
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

  let tokenState: Awaited<ReturnType<typeof getGoogleAccessTokenState>>;
  try {
    tokenState = await getGoogleAccessTokenState(userId);
  } catch (error) {
    // Supabase or the saved settings failed: said as such, not as Next's bare 500.
    return { ok: false, response: handleRouteError(error, "Google token check", "Could not read the Google connection. Try again in a moment.") };
  }

  if (tokenState.status === "missing_auth" || tokenState.status === "reconnect_required") {
    return { ok: false, response: fail(GOOGLE_RECONNECT_MESSAGE, 401) };
  }

  if (tokenState.status === "temporary_failure" || !tokenState.accessToken) {
    return { ok: false, response: fail("Google Calendar is temporarily unavailable. Try again in a moment.", 503) };
  }

  return { ok: true, userId, accessToken: tokenState.accessToken };
}

/** The OAuth callback URL for this request, by the rule in lib/google-redirect-uri; a mismatch is logged. */
export function getGoogleRedirectUri(request: NextRequest): string {
  const { uri, warning } = resolveGoogleRedirectUri(
    process.env.GOOGLE_REDIRECT_URI,
    request.nextUrl.origin,
  );
  if (warning) console.warn(warning);
  return uri;
}
