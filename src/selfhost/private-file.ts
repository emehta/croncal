import { promises as fs } from "node:fs";
import path from "node:path";
import { SetupError } from "@/selfhost/server";

/**
 * The small JSON files only this computer's user may read: the config, the
 * settings and publik's key. Server only.
 *
 * Written through a temporary file and a rename, one save at a time per file,
 * so two saves never lose each other and a crash never leaves half a file.
 */

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** The file's JSON, or null when there is none or it doesn't parse. A file that can't be opened is an error naming its folder. */
export async function readPrivateJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw new SetupError(`CronCal can't read its settings in ${path.dirname(file)}. Check that your account can open that folder.`, 500);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const queues = new Map<string, Promise<unknown>>();

export function writePrivateJson(file: string, value: unknown): Promise<void> {
  const task = async () => {
    const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      try {
        await fs.rename(temp, file);
      } catch {
        // Windows can refuse to rename over a file another process has open.
        await fs.copyFile(temp, file);
        await fs.rm(temp, { force: true });
      }
      if (process.platform !== "win32") await fs.chmod(file, 0o600);
    } catch {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw new SetupError(`CronCal can't save its settings in ${path.dirname(file)}. Check that your account can write to that folder.`, 500);
    }
  };
  const next = (queues.get(file) ?? Promise.resolve()).then(task, task);
  queues.set(file, next.catch(() => undefined));
  return next;
}
