import { NextRequest, NextResponse } from "next/server";
import { badRequest, readJsonObject, requireGoogleAccessToken } from "@/lib/api-route-utils";
import { GoogleEditError, deleteGoogleEvent } from "@/app/api/google-calendar/events/google-edit";
import type { RecurrenceEditScope } from "@/types/calendar-event";

export const dynamic = "force-dynamic";

const SCOPES: RecurrenceEditScope[] = ["single", "following", "all"];

/** Deletes a Google event; `scope` says which days of a series (one day when absent). */
export async function DELETE(request: NextRequest) {
  const auth = await requireGoogleAccessToken(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  const googleEventId = body?.googleEventId;
  if (typeof googleEventId !== "string" || !googleEventId) {
    return badRequest("Missing googleEventId");
  }
  const scope = (body?.scope ?? "single") as RecurrenceEditScope;
  if (!SCOPES.includes(scope)) return badRequest("scope must be single, following or all.");

  try {
    await deleteGoogleEvent({ accessToken: auth.accessToken }, googleEventId, scope);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof GoogleEditError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Google delete event error:", error);
    return NextResponse.json({ error: "Google Calendar could not delete that event. Try again in a moment." }, { status: 500 });
  }
}
