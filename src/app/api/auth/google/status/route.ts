import { NextResponse } from "next/server";
import { getGoogleAccessTokenState, getGoogleAuth, getGoogleCalendarScopeStatus } from "@/lib/google-auth";
import { requireAuthenticatedRequest } from "@/lib/owner";
import { handleRouteError } from "@/lib/api-route-utils";

export const dynamic = "force-dynamic";

/** What this route answers with; the calendar and the Settings tile both read it. */
export interface GoogleStatusPayload {
  connected: boolean;
  /** Linked once, but the grant no longer works and only a reconnect fixes it. */
  needsReconnect: boolean;
  googleEmail: string | null;
  calendarId: string | null;
  tokenExpiry: string | null;
  /** Present instead of the fields above when the check itself failed. */
  error?: string;
}

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedRequest(request);
    const auth = await getGoogleAuth(user.id);

    if (!auth) {
      return NextResponse.json<GoogleStatusPayload>({
        connected: false,
        needsReconnect: false,
        googleEmail: null,
        calendarId: null,
        tokenExpiry: null,
      });
    }

    const tokenState = await getGoogleAccessTokenState(user.id, auth);

    if (tokenState.status === "temporary_failure") {
      return NextResponse.json<GoogleStatusPayload>({
        connected: true,
        needsReconnect: false,
        googleEmail: auth.google_email,
        calendarId: auth.calendar_id,
        tokenExpiry: auth.token_expiry,
      });
    }

    if (tokenState.status === "reconnect_required") {
      return NextResponse.json<GoogleStatusPayload>({
        connected: false,
        needsReconnect: true,
        googleEmail: auth.google_email,
        calendarId: auth.calendar_id,
        tokenExpiry: auth.token_expiry,
      });
    }

    const scopeStatus = tokenState.accessToken
      ? await getGoogleCalendarScopeStatus(tokenState.accessToken)
      : "missing";
    const connected = Boolean(tokenState.accessToken) && scopeStatus !== "missing";

    return NextResponse.json<GoogleStatusPayload>({
      connected,
      needsReconnect: !tokenState.accessToken || scopeStatus === "missing",
      googleEmail: auth.google_email,
      calendarId: auth.calendar_id,
      tokenExpiry: tokenState.tokenExpiry ?? auth.token_expiry,
    });
  } catch (error) {
    return handleRouteError(error, "Google status error", "Could not verify Google Calendar status.");
  }
}
