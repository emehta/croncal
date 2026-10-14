/**
 * Every Google address CronCal calls, in one place. Server only.
 *
 * CRONCAL_GOOGLE_STAND_IN points them all at one local server
 * (scripts/google-stand-in.mjs), so the end-to-end test runs the whole
 * connect and sync flow with no Google account. Only a loopback http://
 * address is accepted, so a stray value can never send tokens elsewhere.
 */

function standIn(): string | null {
  const value = process.env.CRONCAL_GOOGLE_STAND_IN?.trim().replace(/\/+$/, "");
  return value && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(value) ? value : null;
}

export function googleEndpoints() {
  const base = standIn();
  return {
    authorize: `${base ?? "https://accounts.google.com"}/o/oauth2/v2/auth`,
    token: `${base ?? "https://oauth2.googleapis.com"}/token`,
    tokenInfo: `${base ?? "https://oauth2.googleapis.com"}/tokeninfo`,
    revoke: `${base ?? "https://oauth2.googleapis.com"}/revoke`,
    userInfo: `${base ?? "https://www.googleapis.com"}/oauth2/v2/userinfo`,
    events: `${base ?? "https://www.googleapis.com"}/calendar/v3/calendars/primary/events`,
  };
}
