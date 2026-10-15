import { NextRequest, NextResponse } from "next/server";
import { requireGoogleAccessToken } from "@/lib/api-route-utils";
import { fail, readObject } from "@/selfhost/http";
import { googleCreateBody, readGoogleEventCreate } from "@/app/api/google-calendar/events/google-payload";
import { GoogleEditError, createGoogleEvent } from "@/app/api/google-calendar/events/google-edit";
import { mapGoogleEvent } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

/**
 * Adds an event to Google Calendar, where it then lives: the calendar reads
 * it back from Google like every other Google event, so its edits, drags and
 * deletion take the same path theirs do. Answers with the event as the
 * calendar shows it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireGoogleAccessToken(request);
  if (!auth.ok) return auth.response;

  const body = await readObject(request);
  if (!body) return fail("Expected a JSON event.");
  const event = readGoogleEventCreate(body);
  if (typeof event === "string") return fail(event);
  const googleEvent = googleCreateBody(event);
  if (!googleEvent) return fail("The event needs a valid start and end.");

  try {
    const created = await createGoogleEvent({ accessToken: auth.accessToken }, googleEvent);
    return NextResponse.json({ googleEventId: created.id, event: mapGoogleEvent(created) });
  } catch (error) {
    if (error instanceof GoogleEditError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Google create event error:", error);
    return NextResponse.json({ error: "Google Calendar could not add the event. Try again in a moment." }, { status: 500 });
  }
}
