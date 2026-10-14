"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BrowserConfig } from "@/selfhost/config";
import { configureSupabase } from "@/lib/supabase";

const ConfigContext = createContext<BrowserConfig | null>(null);

/**
 * Hands the browser its half of the config (the project URL and the
 * publishable key, never the secret) and makes the Supabase client from it
 * before anything below renders.
 */
export function ConfigProvider({ config, children }: { config: BrowserConfig | null; children: ReactNode }) {
  configureSupabase(config);
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useAppConfig(): BrowserConfig | null {
  return useContext(ConfigContext);
}
