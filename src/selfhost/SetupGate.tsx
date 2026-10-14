"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import AppShell from "@/components/AppShell";
import { getErrorMessage } from "@/lib/error-utils";
import { supabase } from "@/lib/supabase";
import { useAppConfig } from "@/selfhost/ConfigProvider";
import { OWNER_FLAG } from "@/selfhost/constants";
import {
  ConnectScreen,
  CreateAccountScreen,
  DatabaseScreen,
  EnvironmentScreen,
  LoadingScreen,
  ProblemScreen,
  SignInScreen,
} from "@/selfhost/SetupScreens";
import { nextStep, serverState, type SessionState, type StatusResponse } from "@/selfhost/steps";
import { clearPageCache } from "@/lib/page-cache";

const STATUS_TIMEOUT_MS = 20_000;

function sessionState(session: Session | null): SessionState {
  if (!session) return "none";
  return session.user.app_metadata?.[OWNER_FLAG] === true ? "owner" : "stranger";
}

/**
 * Stands where the signed-in app's gate stood: nothing below it renders until
 * the copy is connected, its database is set up, and its owner is signed in.
 */
export default function SetupGate({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  /* Why the status could not be read, shown as the screen's words; and whether a check is under way, for Try again's busy state. */
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [session, setSession] = useState<SessionState | null>(config ? null : "none");
  const [databaseChecks, setDatabaseChecks] = useState(0);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/selfhost/status", { cache: "no-store", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
      const body = (await response.json().catch(() => ({}))) as StatusResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `CronCal couldn't check its setup (${response.status}).`);
      setStatus(body);
      setProblem(null);
    } catch (error) {
      setProblem(
        error instanceof DOMException && error.name === "TimeoutError" ? "That took too long. Try again."
        : error instanceof TypeError ? "Couldn't reach CronCal. Check it's still running."
        : getErrorMessage(error, "Try again in a moment."),
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!config) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(sessionState(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Signed out: the list held for a quick first frame belongs to the account that left.
      if (event === "SIGNED_OUT") clearPageCache();
      if (active) setSession(sessionState(next));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [config]);

  const retry = () => { void refresh(); };
  if (problem) return <ProblemScreen kind="error" message={problem} projectRefValue={null} onRetry={retry} busy={checking} />;

  // A project connected in this tab reaches the page's config only on a fresh load.
  const reload = () => window.location.reload();
  const step = nextStep(serverState(status), session);
  const ref = status?.ref ?? null;
  const fromEnvironment = status?.fromEnvironment ?? false;

  if (switching && !fromEnvironment) return <ConnectScreen mode="switch" onConnected={reload} onCancel={() => setSwitching(false)} />;

  switch (step) {
    case "loading":
      return <LoadingScreen />;
    case "environment":
      return <EnvironmentScreen problems={status?.problems ?? []} rejected={false} onRetry={retry} busy={checking} />;
    case "connect":
      return <ConnectScreen mode="first" onConnected={reload} />;
    case "rejected":
      return fromEnvironment
        ? <EnvironmentScreen problems={[]} rejected onRetry={retry} busy={checking} />
        : <ConnectScreen mode="rejected" onConnected={reload} />;
    case "paused":
    case "unreachable":
      return (
        <ProblemScreen
          kind={step}
          projectRefValue={ref}
          onRetry={retry}
          busy={checking}
          onSwitch={fromEnvironment ? undefined : () => setSwitching(true)}
        />
      );
    case "database":
    case "update-database":
      return (
        <DatabaseScreen
          projectRefValue={ref}
          update={step === "update-database"}
          stillMissing={databaseChecks > 0}
          onCheck={async () => {
            await refresh();
            setDatabaseChecks((count) => count + 1);
          }}
        />
      );
    case "create-account":
      return <CreateAccountScreen onTheWeb={status?.onTheWeb ?? false} onCreated={refresh} />;
    case "sign-in":
      return <SignInScreen projectRefValue={ref} />;
    case "not-owner":
      return <ProblemScreen kind="not-owner" projectRefValue={ref} onRetry={retry} />;
    case "app":
      return <AppShell signupsOpen={status?.signupsOpen ?? null} projectRefValue={ref}>{children}</AppShell>;
  }
}
