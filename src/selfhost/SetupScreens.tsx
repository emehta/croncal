"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowSquareOut, Check, Copy } from "@phosphor-icons/react";
import ExternalLink from "@/components/ExternalLink";
import LoadingState from "@/components/LoadingState";
import StatusBanner from "@/components/StatusBanner";
import { DialogButton } from "@/components/form/Dialog";
import { FieldGroup, FieldStack, TextField } from "@/components/form/fields";
import { OFFLINE_MESSAGE, getErrorMessage } from "@/lib/error-utils";
import { supabase } from "@/lib/supabase";
import { APP_NAME, ITEMS } from "@/selfhost/constants";
import { dashboardLinks, projectRef } from "@/selfhost/keys";

/**
 * The screens between a fresh copy and the app itself: connect a Supabase
 * project, give it the tables, make the one account, sign in. Each says what
 * to do in a line, and links to the exact page of the user's own project
 * where it is done.
 */

/* Longer than the server gives Supabase (the connect route's deadline is 25
   seconds), so its own answer arrives first when there is one. */
const REQUEST_TIMEOUT_MS = 30_000;

async function postJson(url: string, body: Record<string, unknown>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === "TimeoutError") throw new Error("That took too long. Try again.");
    throw failure;
  }
  const answer = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(answer.error ?? `The request failed (${response.status}).`);
}

function Frame({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  /* Each new step takes focus to its heading, so a screen reader reads where
     setup has got to and the keyboard starts from the top of it. */
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div style={{ flex: "1 1 auto", display: "flex", justifyContent: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 520, padding: "72px 20px 48px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold" style={{ outline: "none" }}>{title}</h1>
          {intro && <div style={{ color: "var(--c-text-2)", lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 8 }}>{intro}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 20, listStyle: "decimal", lineHeight: 1.55 }}>{children}</ol>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>;
}

export function LoadingScreen() {
  return (
    <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <LoadingState />
    </div>
  );
}

/**
 * `first`: a new copy. `rejected`: the saved keys stopped working (reset in
 * Supabase), so the same project's new ones are asked for: the server takes
 * no other project once one is saved (README, "Another project").
 */
export function ConnectScreen({
  mode,
  projectRefValue = null,
  onConnected,
}: {
  mode: "first" | "rejected";
  projectRefValue?: string | null;
  onConnected: () => void;
}) {
  const [url, setUrl] = useState(mode === "rejected" && projectRefValue ? `https://${projectRefValue}.supabase.co` : "");
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = projectRef(url.trim());
  const links = ref ? dashboardLinks(ref) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/selfhost/connect", { url, publishableKey, secretKey });
      onConnected();
    } catch (failure) {
      setError(getErrorMessage(failure, "That didn't work. Try again."));
      setBusy(false);
    }
  }

  return (
    <Frame
      title={mode === "rejected" ? "Connect your project again" : `Set up ${APP_NAME}`}
      intro={
        mode === "rejected" ? (
          <p>Supabase no longer accepts the saved keys. Paste your project&apos;s current ones.</p>
        ) : (
          <p>Your {ITEMS} live in your own Supabase project.</p>
        )
      }
    >
      <Steps>
        <li>
          Make a free project on Supabase, or use one you have. <ExternalLink href="https://supabase.com/dashboard/projects">Open Supabase</ExternalLink>
        </li>
        <li>Copy its Project URL from the project&apos;s home page.</li>
        <li>
          Copy both keys from its API Keys page.{" "}
          {links && <ExternalLink href={links.apiKeys}>Open API Keys</ExternalLink>}
        </li>
      </Steps>
      <form onSubmit={submit}>
        <FieldStack>
          <FieldGroup label="Project URL" htmlFor="setup-url">
            <TextField id="setup-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdefghijklmnopqrst.supabase.co" autoComplete="off" spellCheck={false} />
          </FieldGroup>
          <FieldGroup label="Publishable key" htmlFor="setup-publishable">
            <TextField id="setup-publishable" value={publishableKey} onChange={(e) => setPublishableKey(e.target.value)} placeholder="sb_publishable_…" autoComplete="off" spellCheck={false} />
          </FieldGroup>
          <FieldGroup label="Secret key" htmlFor="setup-secret">
            <TextField id="setup-secret" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sb_secret_…" autoComplete="off" spellCheck={false} />
          </FieldGroup>
          {error && <StatusBanner message={error} />}
          <Actions>
            <DialogButton type="submit" variant="primary" busy={busy} disabled={busy}>
              {busy ? "Checking…" : "Connect"}
            </DialogButton>
          </Actions>
          <p style={{ color: "var(--c-text-3)", fontSize: "var(--ui-type-label)", lineHeight: 1.5 }}>The secret key is saved on this computer only.</p>
        </FieldStack>
      </form>
    </Frame>
  );
}

export function DatabaseScreen({
  projectRefValue,
  update,
  stillMissing,
  onCheck,
}: {
  projectRefValue: string | null;
  update: boolean;
  /** Checked at least once and the tables were still not there. */
  stillMissing: boolean;
  onCheck: () => Promise<void>;
}) {
  const [sql, setSql] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showing, setShowing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const links = projectRefValue ? dashboardLinks(projectRefValue) : null;
  const copyFirst = !copied && !showing && !stillMissing;

  /* Fetched as the screen opens, so Copy writes to the clipboard within the
     click itself: Safari refuses a clipboard write that waits on a request
     first, and Safari is a Mac's own browser. */
  useEffect(() => {
    let live = true;
    fetch("/api/selfhost/schema", { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("Could not read the setup. Reload the page."))))
      .then((text) => {
        if (live) setSql(text);
      })
      .catch((failure) => {
        if (live) setError(getErrorMessage(failure, "Could not read the setup. Reload the page."));
      });
    return () => {
      live = false;
    };
  }, []);

  function copy() {
    if (!sql) return;
    setCopyNote(null);
    // No clipboard (an older browser, or a page that isn't secure), or one that refused: shown to copy by hand.
    const refused = () => {
      setShowing(true);
      setCopyNote("Your browser didn't allow copying. Select the setup below and copy it.");
    };
    if (!navigator.clipboard?.writeText) {
      refused();
      return;
    }
    navigator.clipboard.writeText(sql).then(() => setCopied(true), refused);
  }

  async function check() {
    setChecking(true);
    await onCheck();
    setChecking(false);
  }

  return (
    <Frame
      title={update ? "Update your database" : "Add the tables"}
      intro={
        update ? (
          <p>This version changes its tables. Running the setup again keeps all your {ITEMS}.</p>
        ) : (
          <p>Connected.</p>
        )
      }
    >
      <Steps>
        <li>Copy the setup.</li>
        <li>
          Paste it in your project&apos;s SQL Editor and press Run.{" "}
          {links && <ExternalLink href={links.sqlEditor}>Open SQL Editor</ExternalLink>}
        </li>
        <li>Come back and press Check again.</li>
      </Steps>
      {error && <StatusBanner message={error} />}
      {copyNote && <StatusBanner tone="info" message={copyNote} />}
      {!error && stillMissing && !checking && (
        <StatusBanner tone="info" message={update ? "Still the old tables. Make sure Run finished without an error." : "No tables yet. Make sure Run finished without an error."} />
      )}
      <Actions>
        {/* The step to take next is the filled one: Copy, then Check again once it is copied. */}
        <DialogButton variant={copyFirst ? "primary" : "secondary"} onClick={copy} disabled={!sql}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {copied ? <Check size={15} weight="bold" aria-hidden="true" /> : <Copy size={15} weight="bold" aria-hidden="true" />}
            {copied ? "Copied" : "Copy the setup"}
          </span>
        </DialogButton>
        <DialogButton variant={copyFirst ? "secondary" : "primary"} busy={checking} disabled={checking} onClick={() => { void check(); }}>
          {checking ? "Checking…" : "Check again"}
        </DialogButton>
        {!showing && sql && (
          <DialogButton variant="ghost" onClick={() => setShowing(true)}>
            Show the setup
          </DialogButton>
        )}
      </Actions>
      {showing && sql && (
        <textarea
          readOnly
          aria-label="The setup, to copy into the SQL Editor"
          value={sql}
          onFocus={(event) => event.currentTarget.select()}
          rows={12}
          spellCheck={false}
          style={{
            width: "100%",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.5,
            padding: 12,
            color: "var(--c-text-2)",
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: "var(--ui-radius-md)",
            resize: "vertical",
          }}
        />
      )}
    </Frame>
  );
}

export function CreateAccountScreen({ onTheWeb, onCreated }: { onTheWeb: boolean; onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/selfhost/account", { email, password, setupCode });
      // Signing in here skips the sign-in screen; should it fail, that screen comes next anyway.
      await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }).catch(() => undefined);
      await onCreated();
    } catch (failure) {
      setError(getErrorMessage(failure, "That didn't work. Try again."));
      setBusy(false);
      // "Already has its account": asking again moves this screen on to sign-in.
      await onCreated();
    }
  }

  return (
    <Frame
      title="Make your account"
      intro={<p>You&apos;ll sign in with this from now on.</p>}
    >
      <form onSubmit={submit}>
        <FieldStack>
          <FieldGroup label="Email" htmlFor="account-email">
            <TextField id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </FieldGroup>
          <FieldGroup label="Password" htmlFor="account-password">
            <TextField id="account-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="8 characters or more" />
          </FieldGroup>
          {onTheWeb && (
            <FieldGroup label="Setup code" htmlFor="account-code">
              <TextField id="account-code" type="password" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="off" placeholder="The one you chose when you deployed" />
            </FieldGroup>
          )}
          {error && <StatusBanner message={error} />}
          <Actions>
            <DialogButton type="submit" variant="primary" busy={busy} disabled={busy}>
              {busy ? "Making it…" : "Make my account"}
            </DialogButton>
          </Actions>
        </FieldStack>
      </form>
    </Frame>
  );
}

export function SignInScreen({ projectRefValue }: { projectRefValue: string | null }) {
  const [mode, setMode] = useState<"sign-in" | "reset">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = projectRefValue ? dashboardLinks(projectRefValue) : null;

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (signInError) {
        setError(signInError.status === 400 ? "That email and password don't match." : signInError.message);
        setBusy(false);
      }
    } catch (failure) {
      setError(getErrorMessage(failure, "That didn't work. Reload the page and try again."));
      setBusy(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/selfhost/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey: proof, password }),
      });
      const answer = (await response.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!response.ok || !answer.email) throw new Error(answer.error ?? `The request failed (${response.status}).`);
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: answer.email, password });
      if (signInError) throw new Error(`The password was changed, but signing in failed: ${signInError.message}`);
    } catch (failure) {
      setError(getErrorMessage(failure, "That didn't work. Try again."));
      setBusy(false);
    }
  }

  if (mode === "reset") {
    return (
      <Frame
        title="Choose a new password"
        intro={
          <p>
            Paste your project&apos;s secret key to show it&apos;s you.{" "}
            {links && <ExternalLink href={links.apiKeys}>Open API Keys</ExternalLink>}
          </p>
        }
      >
        <form onSubmit={reset}>
          <FieldStack>
            <FieldGroup label="Secret key" htmlFor="reset-proof">
              <TextField id="reset-proof" type="password" value={proof} onChange={(e) => setProof(e.target.value)} autoComplete="off" placeholder="sb_secret_…" spellCheck={false} />
            </FieldGroup>
            <FieldGroup label="New password" htmlFor="reset-password">
              <TextField id="reset-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="8 characters or more" />
            </FieldGroup>
            {error && <StatusBanner message={error} />}
            <Actions>
              <DialogButton type="submit" variant="primary" busy={busy} disabled={busy}>
                {busy ? "Saving…" : "Save and sign in"}
              </DialogButton>
              <DialogButton variant="ghost" onClick={() => { setMode("sign-in"); setError(null); setPassword(""); }} disabled={busy}>
                Back to sign in
              </DialogButton>
            </Actions>
          </FieldStack>
        </form>
      </Frame>
    );
  }

  return (
    <Frame title={`Sign in to ${APP_NAME}`}>
      <form onSubmit={signIn}>
        <FieldStack>
          <FieldGroup label="Email" htmlFor="signin-email">
            <TextField id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </FieldGroup>
          <FieldGroup label="Password" htmlFor="signin-password">
            <TextField id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </FieldGroup>
          {error && <StatusBanner message={error} />}
          <Actions>
            <DialogButton type="submit" variant="primary" busy={busy} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </DialogButton>
            <DialogButton variant="ghost" onClick={() => { setMode("reset"); setError(null); setPassword(""); }} disabled={busy}>
              Forgot password?
            </DialogButton>
          </Actions>
        </FieldStack>
      </form>
    </Frame>
  );
}

export function ProblemScreen({
  kind,
  message,
  projectRefValue,
  onRetry,
  busy = false,
}: {
  kind: "paused" | "unreachable" | "not-owner" | "error";
  /** For "error": what went wrong, in words. */
  message?: string;
  projectRefValue: string | null;
  onRetry: () => void;
  busy?: boolean;
}) {
  const links = projectRefValue ? dashboardLinks(projectRefValue) : null;
  if (kind === "not-owner") {
    return (
      <Frame title={`This account can't use ${APP_NAME}`} intro={<p>Sign in with the account made during setup.</p>}>
        <Actions>
          <DialogButton variant="primary" onClick={() => { void supabase.auth.signOut({ scope: "local" }); }}>Sign out</DialogButton>
        </Actions>
      </Frame>
    );
  }
  const copy = {
    paused: {
      title: "Your Supabase project is paused",
      intro: "Free projects pause after a week unused. Press Restore project on Supabase, then try again.",
    },
    unreachable: {
      title: "Supabase isn't answering",
      intro: OFFLINE_MESSAGE,
    },
    error: {
      title: `${APP_NAME} couldn't check its setup`,
      intro: message ?? "Try again in a moment.",
    },
  }[kind];
  const restore = kind === "paused" && links ? links.project : null;
  return (
    <Frame title={copy.title} intro={<p>{copy.intro}</p>}>
      <Actions>
        {restore && (
          <DialogButton variant="primary" onClick={() => window.open(restore, "_blank", "noopener")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Open Supabase
              <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
            </span>
          </DialogButton>
        )}
        <DialogButton variant={restore ? "secondary" : "primary"} onClick={onRetry} busy={busy} disabled={busy}>
          {busy ? "Checking…" : "Try again"}
        </DialogButton>
      </Actions>
    </Frame>
  );
}

/**
 * A copy whose project comes from environment variables (always so on the
 * web) with one missing or wrong: the Connect form could never work there,
 * so this names the variable to set instead.
 */
export function EnvironmentScreen({ problems, rejected, onRetry, busy = false }: { problems: string[]; rejected: boolean; onRetry: () => void; busy?: boolean }) {
  return (
    <Frame
      title={rejected ? "Supabase didn't accept these keys" : `${APP_NAME} needs its project's settings`}
      intro={
        rejected ? (
          <p>Copy both keys again from API Keys, set them, then restart or redeploy.</p>
        ) : (
          <p>Set these environment variables, then restart or redeploy:</p>
        )
      }
    >
      {!rejected && problems.length > 0 && (
        <ul style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 20, listStyle: "disc", lineHeight: 1.55 }}>
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      <Actions>
        <DialogButton variant="primary" onClick={onRetry} busy={busy} disabled={busy}>
          {busy ? "Checking…" : "Check again"}
        </DialogButton>
      </Actions>
    </Frame>
  );
}
