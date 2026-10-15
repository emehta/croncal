import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api-route-utils";
import { revokeGoogleAuth } from "@/lib/google-auth";
import { requireAuthenticatedRequest } from "@/lib/owner";

export const dynamic = "force-dynamic";

/*
 * handleRouteError, like every other route, so an expired session comes back
 * with the session code authedFetch refreshes and retries on, not a bare 401.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedRequest(request);
    await revokeGoogleAuth(user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err, "Disconnect error", "Could not disconnect Google Calendar. Try again.");
  }
}
