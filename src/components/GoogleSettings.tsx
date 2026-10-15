"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, GoogleLogo } from "@phosphor-icons/react";
import ExternalLink from "@/components/ExternalLink";
import { SettingsRow, settingsNote } from "@/components/SettingsControls";
import StatusBanner from "@/components/StatusBanner";
import Tooltip from "@/components/Tooltip";
import { DialogButton } from "@/components/form/Dialog";
import { TextField } from "@/components/form/fields";
import { authedFetch } from "@/lib/authed-fetch";
import { getErrorMessage } from "@/lib/error-utils";
import { announceGoogleChange } from "@/lib/open-settings";
import type { GoogleStatusPayload } from "@/app/api/auth/google/status/route";

/**
 * Google Calendar's part of Settings. CronCal connects through the owner's
 * own Google Cloud client, so there is no app of anyone else's in between:
 * the steps to make one, its ID and secret, then Connect, then who is
 * connected and Disconnect.
 */

interface ClientStatus {
  saved: boolean;
  fromEnvironment: boolean;
  clientId: string | null;
  redirectUri: string;
}

type Pending = "load" | "save" | "connect" | "disconnect" | "remove" | null;

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authedFetch(path, init);
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `Could not reach CronCal (${response.status}).`);
  return body;
}

const json = { "content-type": "application/json" };
const putClient = (body: Record<string, unknown>) =>
  readJson<ClientStatus>("/api/google/client", { method: "PUT", headers: json, body: JSON.stringify(body) });

const COPIED_FOR_MS = 2000;

const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } as const;

export default function GoogleSettings() {
  const [client, setClient] = useState<ClientStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatusPayload | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pending, setPending] = useState<Pending>("load");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyRefused, setCopyRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectRef = useRef<HTMLElement>(null);
  const busy = pending !== null;

  const load = useCallback(async () => {
    setPending("load");
    setError(null);
    try {
      // Each on its own: a status check that fails still leaves the client form.
      const nextClient = await readJson<ClientStatus>("/api/google/client");
      setClient(nextClient);
      setGoogle(await readJson<GoogleStatusPayload>("/api/auth/google/status"));
    } catch (failure) {
      setError(getErrorMessage(failure, "Could not load Google Calendar's settings."));
    } finally {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function act(kind: Exclude<Pending, null>, task: () => Promise<void>, { keepBusy = false } = {}) {
    setPending(kind);
    setError(null);
    try {
      await task();
      if (!keepBusy) setPending(null);
    } catch (failure) {
      setError(getErrorMessage(failure, "Could not do that. Try again."));
      setPending(null);
    }
  }

  // Busy until the browser has left for Google, so the button never comes back to life first.
  const connect = () =>
    act("connect", async () => {
      const { url } = await readJson<{ url: string }>("/api/auth/google?connect=true");
      window.location.assign(url);
    }, { keepBusy: true });

  const disconnect = () =>
    act("disconnect", async () => {
      // A JSON body, as the guard in front of every write requires (src/proxy.ts).
      await readJson("/api/auth/google/disconnect", { method: "POST", headers: json, body: "{}" });
      announceGoogleChange();
      setGoogle(await readJson<GoogleStatusPayload>("/api/auth/google/status"));
    });

  const remove = () =>
    act("remove", async () => {
      setClient(await putClient({ remove: true }));
      setConfirmingRemove(false);
    });

  const copyRedirect = () => {
    if (!client) return;
    setCopyRefused(false);
    // No clipboard (an older browser, or a page that isn't secure), or one that refused: the address is selected to copy by hand.
    const refused = () => {
      const range = document.createRange();
      if (redirectRef.current) range.selectNodeContents(redirectRef.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      setCopyRefused(true);
    };
    if (!navigator.clipboard?.writeText) {
      refused();
      return;
    }
    navigator.clipboard.writeText(client.redirectUri).then(() => setCopied(true), refused);
  };

  if (!client) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
        <SettingsRow icon={GoogleLogo} label={error ? "Not loaded" : "Checking…"}>
          {error && (
            <DialogButton variant="secondary" busy={pending === "load"} disabled={busy} onClick={() => void load()}>
              {pending === "load" ? "Checking…" : "Try again"}
            </DialogButton>
          )}
        </SettingsRow>
        {error && <StatusBanner message={error} />}
      </div>
    );
  }

  const connected = google?.connected === true;
  const label = connected
    ? google?.googleEmail ?? "Connected"
    : !client.saved
      ? "Not set up"
      : google?.needsReconnect
        ? "Connection ended"
        : "Not connected";

  /* Shown while setting up, and again once saved until connected: a
     redirect_uri_mismatch from Google is fixed by comparing with it. */
  const redirectUri = (
    <>
      <span style={{ ...row, marginTop: 4 }}>
        <code ref={redirectRef} style={{ color: "var(--c-text-2)", overflowWrap: "anywhere" }}>{client.redirectUri}</code>
        <Tooltip label={copied ? "Copied" : "Copy"}>
          <DialogButton variant="ghost" onClick={copyRedirect} aria-label={copied ? "Copied" : "Copy"}>
            {copied ? <Check size={15} weight="bold" aria-hidden="true" /> : <Copy size={15} weight="bold" aria-hidden="true" />}
          </DialogButton>
        </Tooltip>
      </span>
      {copyRefused && <span style={{ display: "block" }}>Your browser didn&apos;t allow copying. The address is selected: copy it by hand.</span>}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
      <SettingsRow icon={GoogleLogo} label={label}>
        {connected ? (
          <DialogButton variant="ghost" busy={pending === "disconnect"} disabled={busy} onClick={() => void disconnect()}>
            {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </DialogButton>
        ) : client.saved && google ? (
          <DialogButton variant="primary" busy={pending === "connect"} disabled={busy} onClick={() => void connect()}>
            {pending === "connect" ? "Opening Google…" : google.needsReconnect ? "Reconnect" : "Connect"}
          </DialogButton>
        ) : client.saved ? (
          <DialogButton variant="secondary" busy={pending === "load"} disabled={busy} onClick={() => void load()}>
            {pending === "load" ? "Checking…" : "Try again"}
          </DialogButton>
        ) : null}
      </SettingsRow>

      {!client.saved && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act("save", async () => {
              setClient(await putClient({ clientId, clientSecret }));
              setClientId("");
              setClientSecret("");
              setGoogle(await readJson<GoogleStatusPayload>("/api/auth/google/status"));
            });
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <ol style={{ ...settingsNote, display: "flex", flexDirection: "column", gap: 6, paddingLeft: 18, listStyle: "decimal" }}>
            <li>In a Google Cloud project, turn on the Google Calendar API. <ExternalLink href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Open it</ExternalLink></li>
            <li>In Google Auth platform, press Get started (External under Audience), then Publish app on Audience. <ExternalLink href="https://console.cloud.google.com/auth/audience">Open Audience</ExternalLink></li>
            <li>
              Make a Web application client with this redirect URI. <ExternalLink href="https://console.cloud.google.com/auth/clients">Open Clients</ExternalLink>
              {redirectUri}
            </li>
            <li>Paste its ID and secret.</li>
          </ol>
          <TextField aria-label="Client ID" value={clientId} onChange={(event) => { setClientId(event.target.value); setError(null); }} placeholder="Client ID" autoComplete="off" spellCheck={false} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <TextField aria-label="Client secret" type="password" value={clientSecret} onChange={(event) => { setClientSecret(event.target.value); setError(null); }} placeholder="Client secret" autoComplete="off" spellCheck={false} />
            </div>
            <DialogButton type="submit" variant="primary" busy={pending === "save"} disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              {pending === "save" ? "Saving…" : "Save"}
            </DialogButton>
          </div>
        </form>
      )}

      {client.saved && !connected && (
        <p style={settingsNote}>Google will say it hasn&apos;t verified the app: it&apos;s your own. Press Advanced, then go on to CronCal.</p>
      )}

      {client.saved && !connected && (
        <div style={settingsNote}>Redirect URI{redirectUri}</div>
      )}

      {client.saved && !connected && !client.fromEnvironment && (
        <div style={row}>
          <span style={{ ...settingsNote, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.clientId}</span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <DialogButton
              variant="danger"
              armed={confirmingRemove}
              busy={pending === "remove"}
              disabled={busy}
              onClick={() => (confirmingRemove ? void remove() : setConfirmingRemove(true))}
            >
              {pending === "remove" ? "Removing…" : confirmingRemove ? "Confirm remove" : "Remove"}
            </DialogButton>
            {confirmingRemove && pending !== "remove" && (
              <DialogButton variant="ghost" onClick={() => setConfirmingRemove(false)}>Keep</DialogButton>
            )}
          </div>
        </div>
      )}

      {error && <StatusBanner message={error} />}
    </div>
  );
}
