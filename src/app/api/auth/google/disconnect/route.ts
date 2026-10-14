import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api-route-utils";
import { revokeGoogleAuth } from "@/lib/google-auth";
import { requireAuthenticatedRequest } from "@/lib/owner";

export const dynamic = "force-dynamic";

/*
 * handleRouteError, like every other route, so an expired session comes back
 * with the session code authedFetch refreshes and retries on. The hand-written
 * catch here answered it with a bare 401, and Disconnect simply failed.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedRequest(request);
    await revokeGoogleAuth(user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err, "Disconnect error", "Failed to disconnect");
  }
}
