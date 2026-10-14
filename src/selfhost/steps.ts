/**
 * Which screen a visit should see, from what the server and the browser know.
 * Pure, so every combination is tested (scripts/setup.test.mjs).
 *
 * The order is the setup's own: connect a project, reach it, give it the
 * tables, make the one account, sign in. A signed-in account that is not the
 * owner (someone who signed up through Supabase's own API) is turned away,
 * because the owner flag is what every table and route checks.
 */

export type Reach = "ok" | "paused" | "unreachable" | "rejected";
export type SchemaState = "ready" | "missing" | "outdated";
export type SessionState = "none" | "owner" | "stranger";

/** What `/api/selfhost/status` answers. */
export interface StatusResponse {
  configured: boolean;
  onTheWeb: boolean;
  /** The project comes from environment variables (always so on the web), so the setup screen cannot connect one. */
  fromEnvironment: boolean;
  /** What is wrong with those variables, by name. */
  problems?: string[];
  ref?: string | null;
  reach?: Reach;
  schema?: SchemaState;
  ownerExists?: boolean | null;
  signupsOpen?: boolean | null;
}

export function serverState(status: StatusResponse | null): ServerState | null {
  if (!status) return null;
  return {
    configured: status.configured,
    fromEnvironment: status.fromEnvironment,
    reach: status.reach ?? null,
    schema: status.schema ?? null,
    ownerExists: status.ownerExists ?? null,
  };
}

export interface ServerState {
  configured: boolean;
  fromEnvironment: boolean;
  reach: Reach | null;
  schema: SchemaState | null;
  ownerExists: boolean | null;
}

export type SetupStep =
  | "loading"
  | "environment"
  | "connect"
  | "paused"
  | "unreachable"
  | "rejected"
  | "database"
  | "update-database"
  | "create-account"
  | "sign-in"
  | "not-owner"
  | "app";

export function nextStep(server: ServerState | null, session: SessionState | null): SetupStep {
  if (!server) return "loading";
  if (!server.configured) return server.fromEnvironment ? "environment" : "connect";
  if (server.reach === "paused") return "paused";
  if (server.reach === "unreachable") return "unreachable";
  if (server.reach === "rejected") return "rejected";
  if (server.schema === "missing") return "database";
  if (server.schema === "outdated") return "update-database";
  if (server.ownerExists === false) return "create-account";
  if (session === null) return "loading";
  if (session === "none") return "sign-in";
  if (session === "stranger") return "not-owner";
  return "app";
}
