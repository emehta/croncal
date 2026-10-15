"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CalendarBlank, Clock, DownloadSimple, UserCircle } from "@phosphor-icons/react";
import { Divider, SectionHeader, SettingsRow, TogglePill, settingsNote } from "@/components/SettingsControls";
import StatusBanner from "@/components/StatusBanner";
import GoogleSettings from "@/components/GoogleSettings";
import ThemePicker from "@/components/ThemePicker";
import { DialogButton, DialogCard, DialogFooter } from "@/components/form/Dialog";
import { downloadMyData } from "@/lib/export-data";
import { getErrorMessage } from "@/lib/error-utils";
import { supabase } from "@/lib/supabase";
import { readStoredTheme, setTheme as persistTheme, type ThemeValue } from "@/lib/theme";
import { setTimeFormat, useTimeFormat } from "@/lib/time-format";
import { setWeekStart, useWeekStart } from "@/lib/week-start";
import { usePhone } from "@/lib/use-viewport-width";
import { dashboardLinks } from "@/selfhost/keys";
import type { SettingsSection } from "@/lib/open-settings";

const signupBox = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 12px",
  border: "1px solid var(--c-border-sub)",
  borderRadius: "var(--ui-radius-item)",
} as const;

/**
 * Whether sign-ups are still open, asked again when Settings opens and each
 * time the tab comes back into view: the warning sends the user to Supabase
 * to turn them off, and should be gone when they return.
 */
function useSignupsOpen(initial: boolean | null): boolean | null {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      void fetch("/api/selfhost/status?fresh=1", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { reach?: string; signupsOpen?: boolean | null } | null) => {
          if (active && body?.reach === "ok" && typeof body.signupsOpen === "boolean") setOpen(body.signupsOpen);
        })
        .catch(() => {
          // The answer the page already had stands.
        });
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      active = false;
      controller?.abort();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);
  return open;
}


export default function SettingsCard({
  onClose,
  signupsOpen: initialSignupsOpen,
  projectRefValue,
  section,
}: {
  onClose: () => void;
  /** Opened from elsewhere at one section, which is scrolled into view. */
  section?: SettingsSection;
  /** Whether the user's Supabase project still lets anyone sign up, as the page last heard. */
  signupsOpen: boolean | null;
  projectRefValue: string | null;
}) {
  const phone = usePhone();
  const [theme, setTheme] = useState<ThemeValue>(() => readStoredTheme());
  const weekStart = useWeekStart();
  const timeFormat = useTimeFormat();
  const [email, setEmail] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const links = projectRefValue ? dashboardLinks(projectRefValue) : null;
  const googleRef = useRef<HTMLDivElement>(null);
  const signupsOpen = useSignupsOpen(initialSignupsOpen);

  useEffect(() => {
    if (section === "google") googleRef.current?.scrollIntoView({ block: "start" });
  }, [section]);

  useEffect(() => {
    let active = true;
    // The saved session already holds the email: no round trip, no blank first frame.
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setEmail(data.session?.user.email ?? "");
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleExport() {
    setExporting(true);
    setExportNote(null);
    try {
      const { events } = await downloadMyData();
      setExportNote({ tone: "success", message: `Saved ${events} event${events === 1 ? "" : "s"} to your downloads.` });
    } catch (error) {
      setExportNote({ tone: "error", message: getErrorMessage(error, "Could not read your data. Try again.") });
    } finally {
      setExporting(false);
    }
  }



  return (
    <DialogCard
      label="Settings"
      heading="Settings"
      onClose={onClose}
      fit
      footer={
        <DialogFooter>
          <DialogButton variant="secondary" onClick={onClose}>Done</DialogButton>
        </DialogFooter>
      }
    >
      <SectionHeader label="Appearance" />
      <ThemePicker value={theme} onChange={(next) => { setTheme(next); persistTheme(next); }} bleed={phone ? 18 : 28} />
      <Divider />
      <SectionHeader label="Preferences" />
      <SettingsRow icon={CalendarBlank} label="Week starts on">
        <TogglePill
          options={[{ value: "sunday", label: "Sun" }, { value: "monday", label: "Mon" }]}
          value={weekStart}
          onChange={(value) => { if (value === "sunday" || value === "monday") setWeekStart(value); }}
          ariaLabel="Week starts on"
        />
      </SettingsRow>
      <SettingsRow icon={Clock} label="Time format">
        <TogglePill
          options={[{ value: "12h", label: "12h" }, { value: "24h", label: "24h" }]}
          value={timeFormat}
          onChange={(value) => { if (value === "12h" || value === "24h") setTimeFormat(value); }}
          ariaLabel="Time format"
        />
      </SettingsRow>
      <Divider />
      <div ref={googleRef}>
        <SectionHeader label="Google Calendar" />
        <GoogleSettings />
      </div>
      <Divider />
      <SectionHeader label="Account" />
      <SettingsRow icon={UserCircle} label={email || "Signed in"}>
        <DialogButton variant="ghost" onClick={() => { void supabase.auth.signOut({ scope: "local" }); }}>
          Sign out
        </DialogButton>
      </SettingsRow>
      <SettingsRow icon={DownloadSimple} label="Back up">
        <DialogButton variant="secondary" onClick={() => { void handleExport(); }} busy={exporting} disabled={exporting}>
          {exporting ? "Saving…" : "Download my data"}
        </DialogButton>
      </SettingsRow>
      {exportNote && <StatusBanner tone={exportNote.tone} message={exportNote.message} style={{ marginBottom: 10 }} />}
      {signupsOpen && (
        <div style={{ ...signupBox, marginTop: 4 }}>
          <span style={settingsNote}>Anyone can sign up to your Supabase project. Switch off &ldquo;Allow new users to sign up&rdquo;.</span>
          {links && (
            <a href={links.authProviders} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-accent)", fontWeight: 600, fontSize: "var(--ui-type-label)", whiteSpace: "nowrap" }}>
              Open Supabase
              <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </DialogCard>
  );
}
