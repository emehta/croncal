import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { secretsMatch } from "@/selfhost/compare";
import type { AppConfig } from "@/selfhost/config";
import { APP, OWNER_FLAG, SCHEMA_VERSION } from "@/selfhost/constants";
import type { Reach, SchemaState } from "@/selfhost/steps";

/**
 * The server's side of setup, against the user's own Supabase project. Server
 * only: everything here holds the secret key.
 */

/** A claim older than this with no account behind it was a create that failed part way. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export class SetupError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Every call to Supabase gives up after this, so a slow project is an error to show, not five minutes of "Loading…". */
const SUPABASE_TIMEOUT_MS = 10_000;

const timedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

export function serverClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  });
}

let admin: { key: string; client: SupabaseClient } | null = null;

export function adminClient(config: AppConfig): SupabaseClient {
  const key = `${config.url}|${config.secretKey}`;
  if (admin?.key !== key) admin = { key, client: serverClient(config.url, config.secretKey) };
  return admin.client;
}

/**
 * Whether `key` is a secret key of this project: the one saved, or any other
 * the project accepts (a second secret key, or the legacy service_role key
 * for a project connected with that). The proof a forgotten password asks
 * for, since only the project's owner can see it in Supabase.
 */
export async function isProjectSecretKey(config: AppConfig, key: string): Promise<boolean> {
  if (!key) return false;
  if (secretsMatch(key, config.secretKey)) return true;
  const { error } = await serverClient(config.url, key).auth.admin.listUsers({ page: 1, perPage: 1 });
  if (!error) return true;
  // Only Supabase saying no is a wrong key; an outage must not read as one.
  if (error.status === 401 || error.status === 403) return false;
  throw new SetupError("Couldn't reach Supabase. Try again.", 502);
}

export interface Probe {
  reach: Reach;
  signupsOpen: boolean | null;
}

/** A good answer is kept this long, so a page load does not ask Supabase every time. */
const PROBE_FRESH_MS = 30_000;
let lastGood: { key: string; at: number; probe: Probe } | null = null;

/**
 * Whether the project answers, accepts both keys, and still lets anyone sign
 * up. A failure is asked again once, a second later, before it is believed:
 * a single dropped request would otherwise show "Supabase isn't answering".
 * `fresh` skips the kept answer, for Settings after a change in Supabase.
 */
export async function probeProject(config: AppConfig, { fresh = false }: { fresh?: boolean } = {}): Promise<Probe> {
  const key = `${config.url}|${config.publishableKey}|${config.secretKey}`;
  if (!fresh && lastGood?.key === key && Date.now() - lastGood.at < PROBE_FRESH_MS) return lastGood.probe;
  let probe = await probeOnce(config);
  if (probe.reach === "unreachable") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    probe = await probeOnce(config);
  }
  lastGood = probe.reach === "ok" ? { key, at: Date.now(), probe } : null;
  return probe;
}

async function probeOnce(config: AppConfig): Promise<Probe> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    return { reach: "unreachable", signupsOpen: null };
  }
  if (response.status === 540) return { reach: "paused", signupsOpen: null };
  if (response.status === 401 || response.status === 403) return { reach: "rejected", signupsOpen: null };
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { reach: /paused/i.test(text) ? "paused" : "unreachable", signupsOpen: null };
  }
  const settings = (await response.json().catch(() => ({}))) as { disable_signup?: unknown };
  const { error } = await adminClient(config).auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) return { reach: error.status === 401 || error.status === 403 ? "rejected" : "unreachable", signupsOpen: null };
  return { reach: "ok", signupsOpen: settings.disable_signup === false };
}

const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

export async function schemaState(client: SupabaseClient): Promise<SchemaState> {
  const { data, error } = await client.from("schema_versions").select("version").eq("app", APP).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(error.code)) return "missing";
    throw new SetupError(`Could not read the database: ${error.message}`, 502);
  }
  if (!data) return "missing";
  return data.version >= SCHEMA_VERSION ? "ready" : "outdated";
}

export async function ownerExists(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.from("app_owner").select("user_id").maybeSingle();
  if (error) throw new SetupError(`Could not read the database: ${error.message}`, 502);
  return Boolean(data?.user_id);
}

/** Takes the one owner row, so two tabs can never both make an account. */
async function claimOwner(client: SupabaseClient): Promise<void> {
  const { error } = await client.from("app_owner").insert({ id: true });
  if (!error) return;
  if (error.code !== "23505") throw new SetupError(`Could not read the database: ${error.message}`, 502);
  const { data } = await client.from("app_owner").select("user_id, claimed_at").maybeSingle();
  if (data?.user_id) throw new SetupError("This project already has its account. Sign in instead.", 409);
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: retaken } = await client
    .from("app_owner")
    .update({ claimed_at: new Date().toISOString() })
    .is("user_id", null)
    .lt("claimed_at", staleBefore)
    .select("id");
  if (!retaken?.length) throw new SetupError("The account is being made in another tab. Wait a moment, then reload.", 409);
}

async function releaseClaim(client: SupabaseClient): Promise<void> {
  await client.from("app_owner").delete().is("user_id", null);
}

/** Sets the owner's password, for a forgotten one: the caller has proved who it is first. */
export async function resetOwnerPassword(config: AppConfig, password: string): Promise<string> {
  const client = adminClient(config);
  const { data, error } = await client.from("app_owner").select("user_id").maybeSingle();
  if (error) throw new SetupError(`Could not read the database: ${error.message}`, 502);
  if (!data?.user_id) throw new SetupError("This project has no account yet. Make one instead.", 409);
  const { data: updated, error: updateError } = await client.auth.admin.updateUserById(data.user_id, { password });
  if (updateError || !updated.user?.email) {
    throw new SetupError(`Supabase did not change the password: ${updateError?.message ?? "no reason given"}`, 502);
  }
  return updated.user.email;
}

/** Makes the project's one account, already confirmed. */
export async function createOwner(config: AppConfig, email: string, password: string): Promise<void> {
  await createOwnerWith(adminClient(config), email, password);
}

/** createOwner on a given client, so the claim, the races and the clean-up are tested (scripts/owner-claim.test.mjs). */
export async function createOwnerWith(client: SupabaseClient, email: string, password: string): Promise<void> {
  await claimOwner(client);
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { [OWNER_FLAG]: true },
  });
  if (error || !data.user) {
    await releaseClaim(client);
    const taken = error?.code === "email_exists" || /already/i.test(error?.message ?? "");
    throw new SetupError(
      taken ? "That email already has an account in this project. Use another email." : `Supabase did not make the account: ${error?.message ?? "no reason given"}`,
      taken ? 409 : 502,
    );
  }
  /* Recorded only over our own claim (no owner yet), and checked: should it
     fail, the account just made is taken away again, so a retry never meets
     an owner-flagged account with no record of it. */
  const { data: recorded, error: ownerError } = await client
    .from("app_owner")
    .update({ user_id: data.user.id })
    .eq("id", true)
    .is("user_id", null)
    .select("user_id");
  if (ownerError || !recorded?.length) {
    await client.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    await releaseClaim(client);
    throw new SetupError(
      ownerError ? `The account could not be recorded: ${ownerError.message}. Try again.` : "Another account was made at the same moment. Sign in instead.",
      ownerError ? 502 : 409,
    );
  }
}
