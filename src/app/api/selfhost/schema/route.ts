import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

/** The database setup, for the Copy button. It holds no secret. */
export async function GET() {
  const sql = await readFile(path.join(process.cwd(), "supabase", "schema.sql"), "utf8");
  return new Response(sql, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
