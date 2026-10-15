import { NextRequest, NextResponse } from "next/server";
import { requireGoogleAccessToken } from "@/lib/api-route-utils";
import { fail } from "@/selfhost/http";
import { GoogleEditError, readSeriesRepeat } from "@/app/api/google-calendar/events/google-edit";

export const dynamic = "force-dynamic";

/**
 * A Google series' repeat, for the event form. Each day of a series comes
 * from Google expanded and without its rule, so the form asks for it when a
 * series is opened to be changed as a whole or from one day on.
 */
export async function GET(request: NextRequest) {
  const seriesId = request.nextUrl.searchParams.get("seriesId");
  if (!seriesId) return fail("Missing seriesId");

  const auth = await requireGoogleAccessToken(request);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(await readSeriesRepeat({ accessToken: auth.accessToken }, seriesId));
  } catch (error) {
    if (error instanceof GoogleEditError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Google series read error:", error);
    return NextResponse.json({ error: "Google Calendar could not be read right now." }, { status: 500 });
  }
}
