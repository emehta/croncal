import { NextRequest, NextResponse } from "next/server";
import { badRequest, readJsonObject, requireGoogleAccessToken } from "@/lib/api-route-utils";
import { GoogleEditError, editGoogleEvent } from "@/app/api/google-calendar/events/google-edit";
import type { GoogleEventChanges, RecurrenceEditScope } from "@/types/calendar-event";

export const dynamic = "force-dynamic";

const SCOPES: RecurrenceEditScope[] = ["single", "following", "all"];
const CHANGE_KEYS: (keyof GoogleEventChanges)[] = [
  "title", "description", "location", "participants", "start_time", "end_time", "all_day", "timezone",
  "color", "importance", "event_type", "link", "repeat",
];

/**
 * Saves a change to a Google event. `scope` says which days of a series it
 * is for (one day when absent); only the keys present are changed.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireGoogleAccessToken(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  const googleEventId = body?.googleEventId;
  if (!body || typeof googleEventId !== "string" || !googleEventId) {
    return badRequest("Missing googleEventId");
  }
  const scope = (body.scope ?? "single") as RecurrenceEditScope;
  if (!SCOPES.includes(scope)) return badRequest("scope must be single, following or all.");

  const changes: Record<string, unknown> = {};
  for (const key of CHANGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) changes[key] = body[key];
  }

  try {
    const result = await editGoogleEvent({ accessToken: auth.accessToken }, googleEventId, scope, changes as GoogleEventChanges);
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
