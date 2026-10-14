import { NextRequest } from "next/server";
import { getGoogleRedirectUri } from "@/lib/api-route-utils";
import { fail, fromError, ok, readObject, text } from "@/selfhost/http";
import { googleClientFromEnv, looksLikeClientId, readGoogleClient, saveGoogleClient } from "@/selfhost/google-client";
import { requireOwner } from "@/selfhost/owner";

export const dynamic = "force-dynamic";

/**
 * The owner's Google Cloud client, for Settings. GET says whether one is
 * saved (the ID, which Google shows on any consent screen anyway, but never
 * the secret) and the redirect URI to give Google. PUT saves `{ clientId,
 * clientSecret }`, or removes it with `{ remove: true }`.
 */
async function status(request: NextRequest, ownerOverride?: Awaited<ReturnType<typeof requireOwner>>) {
  const owner = ownerOverride ?? (await requireOwner(request));
  const client = await readGoogleClient(owner);
  return ok({
    saved: Boolean(client),
    fromEnvironment: Boolean(googleClientFromEnv()),
    clientId: client?.clientId ?? null,
    redirectUri: getGoogleRedirectUri(request),
  });
}

export async function GET(request: NextRequest) {
  try {
    return await status(request);
  } catch (error) {
    return fromError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const owner = await requireOwner(request);
    if (googleClientFromEnv()) return fail("This copy reads its Google client from GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", 409);
    const body = await readObject(request);
    if (!body) return fail("Send the client ID and secret as JSON.");
    if (body.remove === true) {
      await saveGoogleClient(owner, null);
      return await status(request, owner);
    }
    const clientId = text(body, "clientId");
    const clientSecret = text(body, "clientSecret");
    if (!looksLikeClientId(clientId)) return fail("That isn't a client ID. It ends with .apps.googleusercontent.com.");
    if (clientSecret.length < 10 || /\s/.test(clientSecret)) return fail("Paste the client secret too. It usually starts with GOCSPX-.");
    await saveGoogleClient(owner, { clientId, clientSecret });
    return await status(request, owner);
  } catch (error) {
    return fromError(error);
  }
}
