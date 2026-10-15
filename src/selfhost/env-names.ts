/**
 * The environment variables that can name a copy's project, each kind in the
 * order they are read (src/selfhost/config.ts). A module of its own, with no
 * imports, so scripts/smoke.mjs, a plain Node script, empties exactly these.
 */
export const ENV_NAMES = {
  url: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
  publishableKey: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  secretKey: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
} as const;
