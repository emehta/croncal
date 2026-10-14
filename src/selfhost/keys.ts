/**
 * What a user pastes while connecting their Supabase project, sorted by what
 * each piece is rather than by which box it went in. Pure, so it is tested.
 *
 * New projects have a publishable key (`sb_publishable_…`) and a secret key
 * (`sb_secret_…`). Older ones have JWTs whose `role` claim says `anon` or
 * `service_role`, and those still work, so both kinds are read.
 */

export interface PastedKeys {
  url: string | null;
  publishableKey: string | null;
  secretKey: string | null;
}

const PROJECT_URL = /https:\/\/([a-z0-9]{20})\.supabase\.co\b/;
const PUBLISHABLE = /\bsb_publishable_[A-Za-z0-9_-]{10,}/;
const SECRET = /\bsb_secret_[A-Za-z0-9_-]{10,}/;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** The `role` claim of a Supabase JWT, or null if it is not one. */
export function jwtRole(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

/** Finds the project URL and both keys anywhere in what was pasted. */
export function sortPasted(text: string): PastedKeys {
  const url = text.match(PROJECT_URL);
  let publishableKey = text.match(PUBLISHABLE)?.[0] ?? null;
  let secretKey = text.match(SECRET)?.[0] ?? null;
  for (const token of text.match(JWT) ?? []) {
    const role = jwtRole(token);
    if (role === "anon" && !publishableKey) publishableKey = token;
    if (role === "service_role" && !secretKey) secretKey = token;
  }
  return { url: url ? `https://${url[1]}.supabase.co` : null, publishableKey, secretKey };
}

/** The 20-letter project reference in a Supabase project URL. */
export function projectRef(url: string): string | null {
  return url.match(PROJECT_URL)?.[1] ?? null;
}

/** Pages of the user's own project, linked from the setup screens. */
export function dashboardLinks(ref: string) {
  const project = `https://supabase.com/dashboard/project/${ref}`;
  return {
    apiKeys: `${project}/settings/api-keys`,
    sqlEditor: `${project}/sql/new`,
    authProviders: `${project}/auth/providers`,
    project,
  };
}
