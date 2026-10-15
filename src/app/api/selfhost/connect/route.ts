import { configFromEnvironment, onTheWeb, readAppConfig, writeAppConfig } from "@/selfhost/config";
import { APP_NAME } from "@/selfhost/constants";
import { fail, fromError, ok, readObject, text } from "@/selfhost/http";
import { sortPasted } from "@/selfhost/keys";
import { probeProject, type Probe } from "@/selfhost/server";

export const dynamic = "force-dynamic";

/* Each call to Supabase has its own limit, and a failed check is asked again
   once, so a slow project could add them up. Past this, it isn't answering;
   the page gives up a little later. */
const CONNECT_DEADLINE_MS = 25_000;

/**
 * Saves the project a copy on this computer uses, after Supabase has
 * accepted both keys. Once one is saved, only new keys for that same project
 * are taken (keys reset in Supabase), so a page can never move the copy to
 * another project: that is done by hand (README, "Another project"). Never
 * when environment variables set the project, and never on the web, where
 * they always do.
 */
export async function POST(request: Request) {
  try {
    if (onTheWeb()) return fail("This copy is set up through its hosting, not here.", 404);
    if (configFromEnvironment()) {
      return fail("This copy reads its project from environment variables (NEXT_PUBLIC_SUPABASE_URL and the keys). Change them there, or remove them to connect here.", 409);
    }
    const body = await readObject(request);
    if (!body) return fail("Send the project URL and keys as JSON.");

    const pasted = sortPasted(["url", "publishableKey", "secretKey", "pasted"].map((key) => text(body, key)).join("\n"));
    if (!pasted.url) return fail("Paste your Project URL.");
    if (!pasted.publishableKey && !pasted.secretKey) return fail("Paste both keys from your project's API Keys page.");
    if (!pasted.publishableKey) return fail("The publishable key is missing. It starts with sb_publishable_.");
    if (!pasted.secretKey) return fail("The secret key is missing. On the API Keys page, press the eye beside it to show it.");

    const existing = await readAppConfig();
    if (existing && existing.url !== pasted.url) {
      return fail(`${APP_NAME} is connected to another project. To switch, see the README.`, 409);
    }

    const config = { url: pasted.url, publishableKey: pasted.publishableKey, secretKey: pasted.secretKey };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<Probe>((resolve) => {
      timer = setTimeout(() => resolve({ reach: "unreachable", signupsOpen: null }), CONNECT_DEADLINE_MS);
    });
    let reach: Probe["reach"];
    try {
      ({ reach } = await Promise.race([probeProject(config, { fresh: true }), late]));
    } finally {
      clearTimeout(timer);
    }
    if (reach === "paused") return fail("This project is paused. Open it on supabase.com, press Restore project, and try again.", 409);
    if (reach === "unreachable") return fail("Could not reach that project. Check the Project URL, and check you're online.", 502);
    if (reach === "rejected") return fail("Supabase did not accept those keys. Copy both again from the API Keys page.", 401);

    await writeAppConfig(config);
    return ok();
  } catch (error) {
    return fromError(error);
  }
}
