"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowSquareOut, Check, Copy, GoogleLogo } from "@phosphor-icons/react";
import { SettingsRow, settingsNote } from "@/components/SettingsControls";
import StatusBanner from "@/components/StatusBanner";
import { DialogButton } from "@/components/form/Dialog";
import { TextField } from "@/components/form/fields";
import { authedFetch } from "@/lib/authed-fetch";
import { getErrorMessage } from "@/lib/error-utils";
import type { GoogleStatusPayload } from "@/app/api/auth/google/status/route";

/**
 * Google Calendar's part of Settings. CronCal connects through the owner's
 * own Google Cloud client, so there is no app of anyone else's in between:
 * first its ID and secret (with the redirect URI to give Google), then
 * Connect, then who is connected and Disconnect.
 */

interface ClientStatus {
  saved: boolean;
  fromEnvironment: boolean;
  clientId: string | null;
  redirectUri: string;
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authedFetch(path, init);
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `That didn't work (${response.status}).`);
  return body;
}

const putClient = (body: Record<string, unknown>) =>
  readJson<ClientStatus>("/api/google/client", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-accent)", fontWeight: 600, fontSize: "var(--ui-type-label)" }}>
      {children}
      <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
    </a>
  );
}

const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } as const;

export default function GoogleSettings() {
  const [client, setClient] = useState<ClientStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatusPayload | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextClient, nextGoogle] = await Promise.all([
      readJson<ClientStatus>("/api/google/client"),
      readJson<GoogleStatusPayload>("/api/auth/google/status"),
    ]);
    setClient(nextClient);
    setGoogle(nextGoogle);
  }, []);

  useEffect(() => {
    load().catch((failure: unknown) => setError(getErrorMessage(failure, "Google Calendar's settings didn't load.")));
  }, [load]);

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (failure) {
      setError(getErrorMessage(failure, "That didn't work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    act(async () => {
      const { url } = await readJson<{ url: string }>("/api/auth/google?connect=true&format=json");
      window.location.assign(url);
    });

  const disconnect = () =>
    act(async () => {
      await readJson("/api/auth/google/disconnect", { method: "POST" });
      await load();
    });

  const copyRedirect = () => {
    if (!client) return;
    void navigator.clipboard.writeText(client.redirectUri).then(() => setCopied(true), () => undefined);
  };

  if (!client || !google) {
    return (
      <>
        <SettingsRow icon={GoogleLogo} label="Google Calendar">
          <span style={settingsNote}>{error ? "" : "Checking…"}</span>
        </SettingsRow>
        {error && <StatusBanner message={error} style={{ marginBottom: 8 }} />}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
      {google.connected ? (
        <SettingsRow icon={GoogleLogo} label={google.googleEmail ?? "Connected"}>
          <DialogButton variant="ghost" busy={busy} disabled={busy} onClick={() => void disconnect()}>Disconnect</DialogButton>
        </SettingsRow>
      ) : client.saved ? (
        <SettingsRow icon={GoogleLogo} label="Google Calendar">
          <DialogButton variant="primary" busy={busy} disabled={busy} onClick={() => void connect()}>
            {google.needsReconnect ? "Reconnect" : "Connect"}
          </DialogButton>
        </SettingsRow>
      ) : (
        <SettingsRow icon={GoogleLogo} label="Google Calendar">
          <Link href="https://console.cloud.google.com/apis/credentials">Open Google Cloud</Link>
        </SettingsRow>
      )}

      {!client.saved && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              setClient(await putClient({ clientId, clientSecret }));
              setClientId("");
              setClientSecret("");
            });
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <p style={settingsNote}>Paste your Google Cloud client&apos;s ID and secret. Give Google this redirect URI:</p>
          <div style={row}>
            <code style={{ ...settingsNote, color: "var(--c-text-2)", overflowWrap: "anywhere" }}>{client.redirectUri}</code>
            <DialogButton variant="ghost" onClick={copyRedirect} aria-label="Copy the redirect URI">
              {copied ? <Check size={15} weight="bold" aria-hidden="true" /> : <Copy size={15} weight="bold" aria-hidden="true" />}
            </DialogButton>
          </div>
          <TextField aria-label="Client ID" value={clientId} onChange={(event) => { setClientId(event.target.value); setError(null); }} placeholder="Client ID" autoComplete="off" spellCheck={false} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <TextField aria-label="Client secret" type="password" value={clientSecret} onChange={(event) => { setClientSecret(event.target.value); setError(null); }} placeholder="Client secret" autoComplete="off" spellCheck={false} />
            </div>
            <DialogButton type="submit" variant="primary" busy={busy} disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              {busy ? "Saving…" : "Save"}
            </DialogButton>
          </div>
        </form>
      )}

      {client.saved && !google.connected && !client.fromEnvironment && (
        <div style={row}>
          <span style={{ ...settingsNote, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.clientId}</span>
          <DialogButton variant="ghost" disabled={busy} onClick={() => void act(async () => setClient(await putClient({ remove: true })))}>Change</DialogButton>
        </div>
      )}

      {error && <StatusBanner message={error} />}
    </div>
  );
}
