/**
 * Which callback URL to hand Google.
 *
 * Google requires the value sent when starting the flow to match the value sent
 * when exchanging the code *exactly*, so both sides resolve it through here.
 *
 * The request's own origin wins whenever it disagrees with
 * GOOGLE_REDIRECT_URI. A stale value there used to be silent and fatal: after
 * the site moved domains the variable still pointed at the old one, so Google
 * named the old host on its consent screen and then returned the user to a
 * domain that no longer served the callback — a 404 at the end of an otherwise
 * successful sign-in, with nothing to say why. The variable is still honoured
 * when it agrees with the request, which is the case it exists for (a proxy in
 * front of the app), and a mismatch is reported rather than swallowed.
 *
 * No imports on purpose: this is the decision on its own, so it can be
 * exercised directly without constructing a request.
 */
export function resolveGoogleRedirectUri(
  configured: string | undefined,
  requestOrigin: string,
): { uri: string; warning?: string } {
  const fromRequest = new URL("/api/auth/google/callback", requestOrigin).toString();

  if (!configured) return { uri: fromRequest };

  let configuredOrigin: string;
  try {
    configuredOrigin = new URL(configured).origin;
  } catch {
    return {
      uri: fromRequest,
      warning: `GOOGLE_REDIRECT_URI is not a valid URL. Using ${fromRequest}.`,
    };
  }

  if (configuredOrigin === requestOrigin) return { uri: configured };

  return {
    uri: fromRequest,
    warning:
      `GOOGLE_REDIRECT_URI points at ${configuredOrigin} but this request came from `
      + `${requestOrigin}. Using ${fromRequest} instead. Update or remove the variable, `
      + `and make sure this URI is registered in the Google Cloud console.`,
  };
}
