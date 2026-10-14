import { createHmac } from "node:crypto";
import { readAppConfig, type AppConfig } from "@/selfhost/config";
import type { Owner } from "@/selfhost/owner";
import { readSecret, writeSecret } from "@/selfhost/secrets";
import { SetupError } from "@/selfhost/server";

/**
 * The owner's own Google Cloud OAuth client, through which CronCal connects
 * Google Calendar: the ID and secret pasted into Settings, kept on the server
 * like every other key (selfhost/secrets). GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET in the environment win. Server only.
 */

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

const KEY = "croncal.google.client";

export function googleClientFromEnv(): GoogleClient | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function isClient(value: unknown): value is GoogleClient {
  const c = value as GoogleClient | null;
  return Boolean(c && typeof c.clientId === "string" && c.clientId && typeof c.clientSecret === "string" && c.clientSecret);
}

export async function readGoogleClient(owner: Owner): Promise<GoogleClient | null> {
  const env = googleClientFromEnv();
  if (env) return env;
  const saved = await readSecret<unknown>(owner, KEY);
  return isClient(saved) ? saved : null;
}

export async function saveGoogleClient(owner: Owner, client: GoogleClient | null): Promise<void> {
  await writeSecret(owner, KEY, client);
}

/** A Google OAuth client ID ends with this; anything else was pasted into the wrong box. */
export function looksLikeClientId(value: string): boolean {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(value.trim());
}

/** The owner a stored Google grant belongs to, for the server's own calls (a token refresh). */
export async function ownerById(userId: string): Promise<Owner> {
  const config = await readAppConfig();
  if (!config) throw new SetupError("This copy is not connected to a Supabase project yet.", 409);
  return { config, userId };
}

/**
 * The key the Google connect cookie is signed with: derived from the
 * project's secret key, so it is the same on every request, needs nothing
 * stored, and is known to nobody who doesn't hold that key.
 */
export function cookieSecret(config: AppConfig): string {
  return createHmac("sha256", config.secretKey).update("croncal google connect cookie").digest("base64url");
}
