import path from "node:path";
import type { Owner } from "@/selfhost/owner";
import { dataDir, onTheWeb } from "@/selfhost/config";
import { readPrivateJson, writePrivateJson } from "@/selfhost/private-file";
import { adminClient, SetupError } from "@/selfhost/server";

/**
 * Small settings the server keeps for the owner: the Google Cloud client
 * Google Calendar connects through. Server only; none of it reaches the browser.
 *
 * On someone's own computer they live in a file beside the config, readable
 * by their account alone, so a key never leaves the computer. On the web
 * (Vercel, which has no disk that lasts) they live in the project's
 * server-only `app_settings` table, which no browser can read.
 */

const FILE = "settings.json";

type Values = Record<string, unknown>;

const settingsFile = () => path.join(dataDir(), FILE);

async function readFile(): Promise<Values> {
  const parsed = await readPrivateJson(settingsFile());
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Values) : {};
}

/* A change is read, edited and written as one step, so two saves never lose each other. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export async function readSecret<T>(owner: Owner, key: string): Promise<T | null> {
  if (!onTheWeb()) return ((await readFile())[key] as T | undefined) ?? null;
  const { data, error } = await adminClient(owner.config)
    .from("app_settings")
    .select("value")
    .eq("user_id", owner.userId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new SetupError(`Could not read the settings: ${error.message}`, 502);
  return (data?.value as T | undefined) ?? null;
}

export async function writeSecret(owner: Owner, key: string, value: unknown): Promise<void> {
  if (!onTheWeb()) {
    await serial(async () => {
      const values = await readFile();
      if (value === null) delete values[key];
      else values[key] = value;
      await writePrivateJson(settingsFile(), values);
    });
    return;
  }
  const client = adminClient(owner.config).from("app_settings");
  const { error } =
    value === null
      ? await client.delete().eq("user_id", owner.userId).eq("key", key)
      : await client.upsert({ user_id: owner.userId, key, value, updated_at: new Date().toISOString() });
  if (error) throw new SetupError(`Could not save the settings: ${error.message}`, 502);
}
