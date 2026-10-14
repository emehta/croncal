import { NextRequest } from "next/server";
import { verifySignedValue } from "@/lib/crypto-utils";
import { upsertGoogleAuth } from "@/lib/google-auth";
import { getGoogleRedirectUri } from "@/lib/api-route-utils";
import { readAppConfig } from "@/selfhost/config";
import { cookieSecret, ownerById, readGoogleClient, type GoogleClient } from "@/selfhost/google-client";

export const dynamic = "force-dynamic";

/**
 * Why a connection attempt ended where it did.
 *
 * Every failure used to redirect to a bare /calendar, so a refused or expired
 * attempt looked exactly like a successful one: back on the calendar with no
 * connection and nothing said about it. The calendar page turns these into a
 * sentence.
 */
type CallbackOutcome =
  | "connected"
  | "expired"
  | "denied"
  | "scope_missing"
  | "failed";

function calendarPath(outcome: CallbackOutcome): string {
  return `/calendar?google=${outcome}`;
}

/*
 * upsertGoogleAuth throws plain messages for the two cases worth telling apart
 * from a generic failure: a grant that came back without calendar permission,
 * and one that came back without a refresh token.
 */
function classifyFailure(error: unknown): CallbackOutcome {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("permission was not granted")) return "scope_missing";
  if (message.includes("refresh token")) return "denied";
  return "failed";
}

/* A hung token exchange or userinfo read fails the connect instead of holding the route. */
const GOOGLE_TIMEOUT_MS = 10_000;

const CALENDAR_COOKIES = ["croncal_google_oauth_state", "croncal_google_user_id"] as const;

function clearCookie(response: Response, name: string) {
  response.headers.append(
    "Set-Cookie",
    `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
}

function redirectTo(request: NextRequest, path: string, cookiesToClear: readonly string[]) {
  const url = new URL(path, request.url);
  const response = new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  });

  for (const cookie of cookiesToClear) {
    clearCookie(response, cookie);
  }

  return response;
}

async function exchangeGoogleCode(request: NextRequest, code: string, client: GoogleClient) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: getGoogleRedirectUri(request),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });

  if (!tokenRes.ok) {
    throw new Error("Could not complete the Google Calendar connection.");
  }

  return tokenRes.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

async function fetchGoogleEmail(accessToken: string) {
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });

  if (!userInfoRes.ok) {
    throw new Error("Could not read your Google Calendar account.");
  }

  const userInfo = await userInfoRes.json() as { email?: string };

  if (!userInfo.email) {
    throw new Error("Your Google account did not provide an email address.");
  }

  return userInfo.email.trim().toLowerCase();
}

async function handleCalendarCallback(request: NextRequest, code: string, state: string) {
  const stateCookie = request.cookies.get("croncal_google_oauth_state")?.value;
  /*
   * Whose attempt this is, from a cookie the start route signed. An unsigned
   * or altered one is treated like a stale attempt: the tokens are written
   * under this id, so it must be one this server issued.
   */
  const config = await readAppConfig().catch(() => null);
  const userId = config ? verifySignedValue(request.cookies.get("croncal_google_user_id")?.value, cookieSecret(config)) : null;

  if (!stateCookie || state !== stateCookie || !userId) {
    // The attempt is older than its ten-minute cookies, or was not started here.
    return redirectTo(request, calendarPath("expired"), CALENDAR_COOKIES);
  }

  try {
    const client = await readGoogleClient(await ownerById(userId));
    if (!client) throw new Error("No Google client is saved.");
    const tokens = await exchangeGoogleCode(request, code, client);
    const email = await fetchGoogleEmail(tokens.access_token);
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await upsertGoogleAuth({
      userId,
      google_email: email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_expiry: tokenExpiry,
      calendar_id: "primary",
    });

    return redirectTo(request, calendarPath("connected"), CALENDAR_COOKIES);
  } catch (error) {
    console.error("Google Calendar callback failed:", error);
    return redirectTo(request, calendarPath(classifyFailure(error)), CALENDAR_COOKIES);
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const startedCalendarFlow = Boolean(request.cookies.get("croncal_google_oauth_state")?.value);

  if (!code || !state || !startedCalendarFlow) {
    /*
     * No code at all is Google reporting a refusal — the user pressed Cancel on
     * the consent screen. A missing state or start cookie means the attempt did
     * not begin here, or waited too long.
     */
    const denied = request.nextUrl.searchParams.get("error") !== null;
    return redirectTo(
      request,
      calendarPath(denied ? "denied" : "expired"),
      CALENDAR_COOKIES,
    );
  }

  // handleCalendarCallback verifies the state cookie itself before trusting the code.
  return handleCalendarCallback(request, code, state);
}
