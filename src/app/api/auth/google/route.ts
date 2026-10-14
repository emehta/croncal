import { NextRequest, NextResponse } from "next/server";
import { getGoogleRedirectUri, handleRouteError } from "@/lib/api-route-utils";
import { signValue } from "@/lib/crypto-utils";
import { GOOGLE_EVENTS_SCOPE } from "@/lib/google-auth";
import { AuthAccessError } from "@/lib/owner";
import { cookieSecret, readGoogleClient } from "@/selfhost/google-client";
import { requireOwner } from "@/selfhost/owner";
import { SetupError } from "@/selfhost/server";
import { googleEndpoints } from "@/lib/google-endpoints";

export const dynamic = "force-dynamic";

/**
 * Starts connecting Google Calendar: answers with Google's consent page for
 * the owner's own OAuth client (`?format=json` gives the address to open),
 * and sets the cookies the callback checks. `?connect=true` is required, so a
 * prefetch or a cached redirect never starts one.
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("connect") !== "true") {
    return NextResponse.json({ error: "Use Connect Google Calendar in Settings." }, { status: 400 });
  }

  try {
    let owner;
    try {
      owner = await requireOwner(request);
    } catch (error) {
      if (error instanceof SetupError) throw new AuthAccessError(error.message, error.status);
      throw error;
    }
    const client = await readGoogleClient(owner);
    if (!client) {
      return NextResponse.json({ error: "Add your Google client ID and secret in Settings first." }, { status: 409 });
    }

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
    const response = request.nextUrl.searchParams.get("format") === "json" ? NextResponse.json({ url }) : NextResponse.redirect(url);

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
