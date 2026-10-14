import { configFromEnvironment, onTheWeb, readAppConfig, writeAppConfig } from "@/selfhost/config";
import { fail, fromError, ok, readObject, text } from "@/selfhost/http";
import { sortPasted } from "@/selfhost/keys";
import { probeProject } from "@/selfhost/server";

export const dynamic = "force-dynamic";

/**
 * Saves the project a copy on this computer uses, after Supabase has
 * accepted both keys. Only while none is saved, or while the saved one no
 * longer works (keys reset, project paused past restoring, or deleted):
 * a working project cannot be swapped from a page. Never when environment
 * variables set the project, and never on the web, where they always do.
 */
export async function POST(request: Request) {
  try {
    if (onTheWeb()) return fail("This copy is set up through its hosting, not here.", 404);
    if (configFromEnvironment()) {
      return fail("This copy reads its project from environment variables (NEXT_PUBLIC_SUPABASE_URL and the keys). Change them there, or remove them to connect here.", 409);
    }
    const existing = await readAppConfig();
    if (existing && (await probeProject(existing)).reach === "ok") {
      return fail("This copy is already connected to a working project.", 409);
    }
    const body = await readObject(request);
    if (!body) return fail("Send the project URL and keys as JSON.");

    const pasted = sortPasted(["url", "publishableKey", "secretKey", "pasted"].map((key) => text(body, key)).join("\n"));
    if (!pasted.url) return fail("Paste your Project URL.");
    if (!pasted.publishableKey && !pasted.secretKey) return fail("Paste both keys from your project's API Keys page.");
    if (!pasted.publishableKey) return fail("The publishable key is missing. It starts with sb_publishable_.");
    if (!pasted.secretKey) return fail("The secret key is missing. On the API Keys page, press the eye beside it to show it.");

    const config = { url: pasted.url, publishableKey: pasted.publishableKey, secretKey: pasted.secretKey };
    const { reach } = await probeProject(config);
    if (reach === "paused") return fail("This project is paused. Open it on supabase.com, press Restore project, and try again.", 409);
    if (reach === "unreachable") return fail("Could not reach that project. Check the Project URL, and that this computer is online.", 502);
    if (reach === "rejected") return fail("Supabase did not accept those keys. Copy both again from the API Keys page.", 401);

    await writeAppConfig(config);
    return ok();
  } catch (error) {
    return fromError(error);
  }
}
