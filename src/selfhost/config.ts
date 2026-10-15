import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writePrivateJson } from "@/selfhost/private-file";
import { SetupError } from "@/selfhost/server";

/**
 * Where this copy finds its Supabase project. Server only.
 *
 * A copy on the web (Vercel) is given it as environment variables. A copy on
 * someone's own computer gets it from the setup screen, which saves it to a
 * file in the computer's app-data folder: outside this folder, because an
 * update replaces the folder and must not lose it. It is read on every request (cached by the file's time), so a
 * project connected after the build works with no restart.
 *
 * Environment variables are read by a computed name: Next writes a literal
 * `process.env.NEXT_PUBLIC_…` into the build, and the build has none. When
 * they are set they win, and the setup screen cannot change the project.
 */

export interface AppConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/** What the browser is given: never the secret key. */
export interface BrowserConfig {
  url: string;
  publishableKey: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** True on Vercel, where the config comes from the project's variables. */
export function onTheWeb(): boolean {
  return Boolean(env("VERCEL"));
}

export function dataDir(): string {
  const override = env("CRONCAL_DATA_DIR");
  if (override) return path.resolve(override);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "CronCal");
  if (process.platform === "win32") {
    return path.join(env("LOCALAPPDATA") ?? path.join(os.homedir(), "AppData", "Local"), "CronCal");
  }
  return path.join(env("XDG_CONFIG_HOME") ?? path.join(os.homedir(), ".config"), "croncal");
}

function configFile(): string {
  return path.join(dataDir(), "config.json");
}

/**
 * A project URL as the clients need it: https, a host, no trailing slash, no
 * path. A trailing slash made the setup check ask for "//auth/v1/settings",
 * and a missing scheme made the browser client throw while the page drew.
 */
export function normalizeUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(trimmed) ? trimmed : null;
}

const ENV_NAMES = {
  url: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
  publishableKey: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  secretKey: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
} as const;

const firstEnv = (names: readonly string[]) => names.map(env).find(Boolean);

/** Whether any of the project's variables is set, complete or not. */
export function configFromEnvironment(): boolean {
  return Object.values(ENV_NAMES).some((names) => Boolean(firstEnv(names)));
}

/**
 * What is wrong with the variables, by name, or [] when they are complete.
 * Shown on the web, where they are the only way to connect a project.
 */
export function environmentProblems(): string[] {
  const problems: string[] = [];
  const url = firstEnv(ENV_NAMES.url);
  if (!url) problems.push("NEXT_PUBLIC_SUPABASE_URL is not set.");
  else if (!normalizeUrl(url)) problems.push("NEXT_PUBLIC_SUPABASE_URL is not an https address like https://abcdefghijklmnopqrst.supabase.co.");
  if (!firstEnv(ENV_NAMES.publishableKey)) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.");
  if (!firstEnv(ENV_NAMES.secretKey)) problems.push("SUPABASE_SECRET_KEY is not set.");
  return problems;
}

function fromEnv(): AppConfig | null {
  const url = normalizeUrl(firstEnv(ENV_NAMES.url));
  const publishableKey = firstEnv(ENV_NAMES.publishableKey);
  const secretKey = firstEnv(ENV_NAMES.secretKey);
  return url && publishableKey && secretKey ? { url, publishableKey, secretKey } : null;
}

function parse(text: string): AppConfig | null {
  try {
    const value = JSON.parse(text) as Partial<AppConfig>;
    const url = normalizeUrl(value.url);
    if (url && typeof value.publishableKey === "string" && typeof value.secretKey === "string") {
      return { url, publishableKey: value.publishableKey, secretKey: value.secretKey };
    }
  } catch {
    // A file that does not parse means "connect again", never a crash.
  }
  return null;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function unreadable(): SetupError {
  return new SetupError(`CronCal can't read its settings in ${dataDir()}. Check that your account can open that folder.`, 500);
}

let cached: { mtimeMs: number; size: number; config: AppConfig | null } | null = null;

export async function readAppConfig(): Promise<AppConfig | null> {
  if (configFromEnvironment() || onTheWeb()) return fromEnv();
  let stat;
  try {
    stat = await fs.stat(configFile());
  } catch (error) {
    cached = null;
    if (missing(error)) return null;
    throw unreadable();
  }
  if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.config;
  let text: string;
  try {
    text = await fs.readFile(configFile(), "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw unreadable();
  }
  const config = parse(text);
  cached = { mtimeMs: stat.mtimeMs, size: stat.size, config };
  return config;
}

/** Saves the config for a copy on this computer, readable by its owner only. */
export async function writeAppConfig(config: AppConfig): Promise<void> {
  try {
    await writePrivateJson(configFile(), config);
  } finally {
    cached = null;
  }
}

export function browserHalf(config: AppConfig | null): BrowserConfig | null {
  return config ? { url: config.url, publishableKey: config.publishableKey } : null;
}
