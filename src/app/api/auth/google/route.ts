import { NextRequest, NextResponse } from "next/server";
import { getGoogleRedirectUri, handleRouteError } from "@/lib/api-route-utils";
import { fail } from "@/selfhost/http";
import { signValue } from "@/lib/crypto-utils";
import { GOOGLE_EVENTS_SCOPE } from "@/lib/google-auth";
import { requireAuthenticatedRequest } from "@/lib/owner";
import { cookieSecret, readGoogleClient } from "@/selfhost/google-client";
import { googleEndpoints } from "@/lib/google-endpoints";

export const dynamic = "force-dynamic";

/**
 * Starts connecting Google Calendar: answers with the address of Google's
 * consent page for the owner's own OAuth client, for the page to open, and
 * sets the cookies the callback checks. `?connect=true` is required, so a
 * prefetch never starts one.
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("connect") !== "true") return fail("Connect Google Calendar from Settings.");

  try {
    const owner = await requireAuthenticatedRequest(request);
    const client = await readGoogleClient(owner);
    if (!client) return fail("Add your Google client ID and secret in Settings first.", 409);

    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: getGoogleRedirectUri(request),
      response_type: "code",
      scope: `${GOOGLE_EVENTS_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    const url = `${googleEndpoints().authorize}?${params.toString()}`;
    const response = NextResponse.json({ url });

    const cookie = { httpOnly: true, sameSite: "lax" as const, secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 10 };
    response.cookies.set("croncal_google_oauth_state", state, cookie);
    /*
     * Signed, because the callback writes Google's tokens under whatever id
     * this cookie names, and a cookie is the browser's to set. Unsigned, anyone
     * who knew the owner's id could set it in their own browser, consent with
     * their own Google account, and have the owner's calendar writes go to it.
     */
    response.cookies.set("croncal_google_user_id", signValue(owner.userId, cookieSecret(owner.config)), cookie);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  } catch (error) {
    return handleRouteError(error, "Google connect", "Could not start connecting Google Calendar.");
  }
}
