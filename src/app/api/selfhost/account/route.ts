import { onTheWeb, readAppConfig } from "@/selfhost/config";
import { secretsMatch } from "@/selfhost/compare";
import { fail, fromError, ok, passwordProblem, readObject, text } from "@/selfhost/http";
import { createOwner } from "@/selfhost/server";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* Long enough that guessing it before the owner makes the account is hopeless. */
const MIN_SETUP_CODE = 12;

/**
 * Makes the project's one account. A copy on this computer is reachable only
 * from this computer; a copy on the web asks for the setup code chosen when
 * it was deployed, so the first stranger to find the address cannot take it.
 */
export async function POST(request: Request) {
  try {
    const config = await readAppConfig();
    if (!config) return fail("Connect a Supabase project first.", 409);
    const body = await readObject(request);
    if (!body) return fail("Send the email and password as JSON.");

    if (onTheWeb()) {
      const expected = process.env.SETUP_CODE?.trim() ?? "";
      if (expected.length < MIN_SETUP_CODE) return fail(`Set SETUP_CODE (${MIN_SETUP_CODE} characters or more) in your hosting's variables, then redeploy.`, 403);
      if (!secretsMatch(text(body, "setupCode"), expected)) return fail("That setup code is not the one you chose.", 403);
    }

    const email = text(body, "email").toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!EMAIL.test(email)) return fail("Enter an email address.");
    const problem = passwordProblem(password);
    if (problem) return fail(problem);

    await createOwner(config, email, password);
    return ok();
  } catch (error) {
    return fromError(error);
  }
}
