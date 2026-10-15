import { NextRequest, NextResponse } from "next/server";
import { requireGoogleAccessToken } from "@/lib/api-route-utils";
import { GoogleCalendarError, fetchGoogleCalendarEvents } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

const RECONNECT_MESSAGE = "Reconnect Google Calendar and allow calendar access.";
const UPSTREAM_MESSAGE = "Google Calendar could not be loaded right now.";

export async function GET(request: NextRequest) {
  const timeMin = request.nextUrl.searchParams.get("timeMin");
  const timeMax = request.nextUrl.searchParams.get("timeMax");

  if (!timeMin || !timeMax) {
    return NextResponse.json([]);
  }

  const auth = await requireGoogleAccessToken(request);
  if (!auth.ok) return auth.response;
  const { accessToken } = auth;

  /*
   * No tokeninfo check first: a missing scope or a dead token comes back from
   * the events call itself as a "scope" failure, and asking Google twice would
   * put a round trip before every calendar load and every adjacent-month
   * prefetch.
   */
  try {
    const events = await fetchGoogleCalendarEvents({ accessToken, timeMin, timeMax });
    return NextResponse.json(events);
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      console.error("Google Calendar fetch failed:", error.detail);
      return error.kind === "scope"
        ? NextResponse.json({ error: RECONNECT_MESSAGE }, { status: 401 })
        : NextResponse.json({ error: UPSTREAM_MESSAGE }, { status: 502 });
    }

    console.error("Google Calendar fetch error:", error);
    return NextResponse.json({ error: UPSTREAM_MESSAGE }, { status: 500 });
  }
}
