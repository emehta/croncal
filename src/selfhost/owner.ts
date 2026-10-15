import type { AppConfig } from "@/selfhost/config";
import { readAppConfig } from "@/selfhost/config";
import { OWNER_FLAG } from "@/selfhost/constants";
import { adminClient, SetupError } from "@/selfhost/server";
import { SESSION_ERROR_CODE } from "@/lib/session-error";

/**
 * A request from the project's owner, proved by their session's access token
 * (authedFetch sends it as a bearer token) and the owner flag Supabase keeps
 * in app_metadata, which only the secret key can set. Server only.
 */

export interface Owner {
  config: AppConfig;
  userId: string;
}

/** A 401 the browser should answer by refreshing its session and trying once more (lib/authed-fetch). */
export class SessionError extends SetupError {
  readonly code = SESSION_ERROR_CODE;

  constructor(message: string) {
    super(message, 401);
  }
}

export async function requireOwner(request: Request): Promise<Owner> {
  const config = await readAppConfig();
  if (!config) throw new SetupError("This copy is not connected to a Supabase project yet.", 409);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new SessionError("Sign in first.");
  const { data, error } = await adminClient(config).auth.getUser(token);
  // Only Supabase refusing the token ends the session; an outage must not read as one.
  if (error && !(error.status && error.status >= 400 && error.status < 500)) {
    throw new SetupError("Could not reach Supabase. Try again in a moment.", 502);
  }
  if (error || !data.user) throw new SessionError("Your session has ended. Sign in again.");
  if (data.user.app_metadata?.[OWNER_FLAG] !== true) throw new SetupError("Only this project's owner can do that.", 403);
  return { config, userId: data.user.id };
}
