import { environmentProblems, configFromEnvironment, onTheWeb, readAppConfig } from "@/selfhost/config";
import { fromError, ok } from "@/selfhost/http";
import { projectRef } from "@/selfhost/keys";
import { adminClient, ownerExists, probeProject, schemaState } from "@/selfhost/server";

export const dynamic = "force-dynamic";

const STATUS_DEADLINE_MS = 15_000;

/**
 * Where setup stands. Names nothing secret: no key, only the project's
 * reference, and, when environment variables set the project, which of them
 * is missing or wrong. `?fresh=1` asks Supabase again rather than reading
 * the answer kept for 30 seconds.
 */
export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const fromEnvironment = configFromEnvironment() || onTheWeb();
    const config = await readAppConfig();
    if (!config) {
      return ok({
        configured: false,
        onTheWeb: onTheWeb(),
        fromEnvironment,
        problems: fromEnvironment ? environmentProblems() : [],
      });
    }
    const base = { configured: true, onTheWeb: onTheWeb(), fromEnvironment, ref: projectRef(config.url) };
    const check = async () => {
      const { reach, signupsOpen } = await probeProject(config, { fresh });
      if (reach !== "ok") return { ...base, reach };
      const client = adminClient(config);
      const schema = await schemaState(client);
      const owner = schema === "missing" ? null : await ownerExists(client);
      return { ...base, reach, schema, ownerExists: owner, signupsOpen };
    };
    /* Each call to Supabase has its own limit, but a slow project could add
       them up past the page's 20 seconds. Past this, it isn't answering. */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof base & { reach: "unreachable" }>((resolve) => {
      timer = setTimeout(() => resolve({ ...base, reach: "unreachable" }), STATUS_DEADLINE_MS);
    });
    try {
      return ok(await Promise.race([check(), late]));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return fromError(error);
  }
}
