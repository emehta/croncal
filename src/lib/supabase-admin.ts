import type { SupabaseClient } from "@supabase/supabase-js";
import { readAppConfig } from "@/selfhost/config";
import { adminClient, SetupError } from "@/selfhost/server";

/** The project's admin client, from the project saved at setup. Server only. */
export async function getAdminClient(): Promise<SupabaseClient> {
  const config = await readAppConfig();
  if (!config) throw new SetupError("This copy is not connected to a Supabase project yet.", 409);
  return adminClient(config);
}
