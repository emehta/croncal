import { getAdminClient } from "@/lib/supabase-admin";
import { ownerById, readGoogleClient } from "@/selfhost/google-client";
import { googleEndpoints } from "@/lib/google-endpoints";

/* What CronCal asks Google for: the events of the user's calendars, nothing else.
   A grant of the whole calendar (an older connection) does as well. */
export const GOOGLE_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/* Google's token endpoints answer in well under a second; one that hangs must not hold the route until the platform kills it. */
const GOOGLE_TIMEOUT_MS = 10_000;

export interface GoogleAuth {
  id: string;
  user_id: string;
  google_email: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  calendar_id: string | null;
  created_at: string;
  updated_at: string;
}

export type GoogleAccessTokenState =
  | {
      status: "missing_auth";
      accessToken: null;
      tokenExpiry: null;
    }
  | {
      status: "valid" | "refreshed";
      accessToken: string;
      tokenExpiry: string;
    }
  | {
      status: "temporary_failure";
      accessToken: string | null;
      tokenExpiry: string | null;
      reason: string;
    }
  | {
      status: "reconnect_required";
      accessToken: null;
      tokenExpiry: string | null;
      reason: string;
    };

export async function getGoogleAuth(userId: string): Promise<GoogleAuth | null> {
  const sb = await getAdminClient();
  const { data, error } = await sb
    .from("google_auth")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  /*
   * A failed read is thrown, not answered as "no row": that made a Supabase
   * hiccup read as Google disconnected, a 401 asking for a reconnect that
   * would fix nothing.
   */
  if (error) throw error;
  return (data as GoogleAuth | null) ?? null;
}

function hasCalendarScope(scopeValue: string | null | undefined): boolean {
  if (!scopeValue) return false;
  const granted = scopeValue.split(/\s+/);
  return granted.includes(GOOGLE_EVENTS_SCOPE) || granted.includes(GOOGLE_CALENDAR_SCOPE);
}

export async function getGoogleCalendarScopeStatus(
  accessToken: string
): Promise<"granted" | "missing" | "unknown"> {
  try {
    const response = await fetch(`${googleEndpoints().tokenInfo}?access_token=${encodeURIComponent(accessToken)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      const normalized = text.toLowerCase();

      if (response.status === 400 || normalized.includes("invalid_token")) {
        return "missing";
      }

      console.error("Google tokeninfo failed:", text);
      return "unknown";
    }

    const payload = await response.json() as { scope?: string };
    return hasCalendarScope(payload.scope) ? "granted" : "missing";
  } catch (error) {
    console.error("Google tokeninfo error:", error);
    return "unknown";
  }
}

function isReconnectRequiredRefreshFailure(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("invalid_grant") ||
    normalized.includes("invalid_request") ||
    normalized.includes("token has been expired or revoked") ||
    (normalized.includes("refresh token") && normalized.includes("expired"))
  );
}

/**
 * A usable access token for the user, refreshing it if it is close to expiry.
 * Pass the row when the caller has already read it, rather than reading it again.
 */
export async function getGoogleAccessTokenState(
  userId: string,
  knownAuth?: GoogleAuth | null,
): Promise<GoogleAccessTokenState> {
  const auth = knownAuth === undefined ? await getGoogleAuth(userId) : knownAuth;
  if (!auth) {
    return {
      status: "missing_auth",
      accessToken: null,
      tokenExpiry: null,
    };
  }

  const expiryTime = new Date(auth.token_expiry).getTime();
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiryTime - now > bufferMs) {
    return {
      status: "valid",
      accessToken: auth.access_token,
      tokenExpiry: auth.token_expiry,
    };
  }

  if (!auth.refresh_token) {
    return {
      status: "reconnect_required",
      accessToken: null,
      tokenExpiry: auth.token_expiry,
      reason: "missing_refresh_token",
    };
  }

  /* No client to refresh with (it was removed in Settings): only adding one
     and connecting again fixes that, so it is a reconnect, not a passing failure. */
  const client = await readGoogleClient(await ownerById(userId));
  if (!client) {
    return {
      status: "reconnect_required",
      accessToken: null,
      tokenExpiry: auth.token_expiry,
      reason: "missing_google_client",
    };
  }

  // Token expired or expiring soon — refresh it
  try {
    const res = await fetch(googleEndpoints().token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: auth.refresh_token,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Token refresh failed:", errorText);

      if (isReconnectRequiredRefreshFailure(errorText)) {
        return {
          status: "reconnect_required",
          accessToken: null,
          tokenExpiry: auth.token_expiry,
          reason: "refresh_token_revoked",
        };
      }

      return {
        status: "temporary_failure",
        accessToken: auth.access_token || null,
        tokenExpiry: auth.token_expiry,
        reason: "refresh_request_failed",
      };
    }

    const tokens = await res.json() as {
      access_token: string;
      expires_in: number;
    };
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const sb = await getAdminClient();
    /*
     * The write has to be checked. The builder resolves with { error } instead
     * of rejecting, so a failed save fell straight through to "refreshed": the
     * request in hand worked, nothing was persisted, and every request after
     * it refreshed again against Google's quota, silently and forever.
     */
    const { error: saveError } = await sb
      .from("google_auth")
      .update({
        access_token: tokens.access_token,
        token_expiry: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", auth.id);

    if (saveError) {
      console.error("Could not persist the refreshed Google token:", saveError);
    }

    return {
      status: "refreshed",
      accessToken: tokens.access_token,
      tokenExpiry: newExpiry,
    };
  } catch (err) {
    console.error("Token refresh error:", err);
    return {
      status: "temporary_failure",
      accessToken: auth.access_token || null,
      tokenExpiry: auth.token_expiry,
      reason: "refresh_request_error",
    };
  }
}

export async function revokeGoogleAuth(userId: string): Promise<void> {
  const auth = await getGoogleAuth(userId);

  /*
   * The refresh token, when there is one: revoking it ends the whole grant,
   * while an access token past its hour revokes nothing.
   */
  const token = auth?.refresh_token || auth?.access_token;
  if (token) {
    try {
      await fetch(`${googleEndpoints().revoke}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      });
    } catch {
      // Best-effort revoke
    }
  }

  /*
   * The service role bypasses RLS, so a row that exists is a row this can
   * delete — but the error was being dropped entirely, which made a failed
   * disconnect indistinguishable from a successful one. Disconnecting and
   * being told it worked, while the tokens are still stored, is the one
   * outcome this function must never produce.
   */
  const sb = await getAdminClient();
  const { error: deleteError } = await sb.from("google_auth").delete().eq("user_id", userId);
  if (deleteError) throw deleteError;
}

export async function upsertGoogleAuth(input: {
  userId: string;
  google_email: string;
  access_token: string;
  refresh_token?: string | null;
  scope?: string | null;
  token_expiry: string;
  calendar_id: string;
}) {
  // The stored row is read only for its refresh token, which a consent screen always sends anew.
  const refreshToken = input.refresh_token || (await getGoogleAuth(input.userId))?.refresh_token || null;

  if (!refreshToken) {
    throw new Error("Missing Google refresh token. Reconnect Google Calendar and try again.");
  }

  const grantedScope = input.scope ?? "";
  if (!hasCalendarScope(grantedScope)) {
    throw new Error("Google Calendar permission was not granted. Reconnect and allow calendar access.");
  }

  const sb = await getAdminClient();
  const { error } = await sb
    .from("google_auth")
    .upsert(
      {
        user_id: input.userId,
        google_email: input.google_email,
        access_token: input.access_token,
        refresh_token: refreshToken,
        token_expiry: input.token_expiry,
        calendar_id: input.calendar_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    throw error;
  }
}
