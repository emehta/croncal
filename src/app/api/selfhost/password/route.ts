import { readAppConfig } from "@/selfhost/config";
import { fail, fromError, ok, passwordProblem, readObject, text } from "@/selfhost/http";
import { sortPasted } from "@/selfhost/keys";
import { isProjectSecretKey, resetOwnerPassword } from "@/selfhost/server";

export const dynamic = "force-dynamic";

/**
 * A forgotten password, set again without email (Supabase's own email only
 * reaches the project's team, and slowly). The proof of being the owner is
 * the project's secret key, pasted again from Supabase: only the owner can
 * see it, and it cannot be guessed, which a setup code chosen by hand could
 * be. Any secret key the project accepts counts, not only the one saved.
 * Answers with the account's email, to sign in with.
 */
export async function POST(request: Request) {
  try {
    const config = await readAppConfig();
    if (!config) return fail("Connect a Supabase project first.", 409);
    const body = await readObject(request);
    if (!body) return fail("Send the secret key and the new password as JSON.");

    const proof = sortPasted(text(body, "secretKey")).secretKey ?? "";
    if (!(await isProjectSecretKey(config, proof))) {
      return fail("That is not this project's secret key. Copy it again from the API Keys page.", 403);
    }

    const password = typeof body.password === "string" ? body.password : "";
    const problem = passwordProblem(password);
    if (problem) return fail(problem);
    const email = await resetOwnerPassword(config, password);
    return ok({ ok: true, email });
  } catch (error) {
    return fromError(error);
  }
}
