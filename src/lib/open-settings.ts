/**
 * Opens the Settings card from anywhere in the app, at a section: the
 * calendar sends people to Google Calendar's when it isn't connected. The
 * frame (components/AppShell) listens.
 */

export const OPEN_SETTINGS_EVENT = "croncal:open-settings";

export type SettingsSection = "google";

export function openSettings(section?: SettingsSection): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section } }));
}

/** Sent when Settings changes the Google connection, so the calendar shows it without a reload. */
export const GOOGLE_CHANGED_EVENT = "croncal:google-changed";

export function announceGoogleChange(): void {
  window.dispatchEvent(new Event(GOOGLE_CHANGED_EVENT));
}
