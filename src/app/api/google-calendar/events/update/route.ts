import { NextRequest, NextResponse } from "next/server";
import { requireGoogleAccessToken } from "@/lib/api-route-utils";
import { fail, readObject } from "@/selfhost/http";
import { GoogleEditError, editGoogleEvent } from "@/app/api/google-calendar/events/google-edit";
import { readGoogleEventChanges } from "@/app/api/google-calendar/events/google-payload";
import type { RecurrenceEditScope } from "@/types/calendar-event";

export const dynamic = "force-dynamic";

const SCOPES: RecurrenceEditScope[] = ["single", "following", "all"];

/**
 * Saves a change to a Google event. `scope` says which days of a series it
 * is for (one day when absent); only the keys present are changed, each
 * checked as the create route checks a new event (readGoogleEventChanges).
 */
export async function PUT(request: NextRequest) {
  const auth = await requireGoogleAccessToken(request);
  if (!auth.ok) return auth.response;

  const body = await readObject(request);
  const googleEventId = body?.googleEventId;
  if (!body || typeof googleEventId !== "string" || !googleEventId) {
    return fail("Missing googleEventId");
  }
  const scope = (body.scope ?? "single") as RecurrenceEditScope;
  if (!SCOPES.includes(scope)) return fail("scope must be single, following or all.");

  const changes = readGoogleEventChanges(body);
  if (typeof changes === "string") return fail(changes);

  try {
    const result = await editGoogleEvent({ accessToken: auth.accessToken }, googleEventId, scope, changes);
    return NextResponse.json({ googleEventId, ...result });
  } catch (error) {
    if (error instanceof GoogleEditError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Google update event error:", error);
    return NextResponse.json({ error: "Google Calendar could not save that change. Try again in a moment." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  return PUT(request);
}
