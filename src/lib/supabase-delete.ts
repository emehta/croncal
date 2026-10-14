import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Turn a delete that removed nothing into an error.
 *
 * PostgREST answers a DELETE that matched no rows with **no error**. Under RLS
 * that is the same answer you get when the row exists but this session is not
 * allowed to see it — so a policy problem, a stale id, and a genuine success
 * are indistinguishable unless the statement asks for the deleted rows back.
 * `.select("id")` is what makes them distinguishable, and this is the check
 * that reads the result.
 *
 * Only for deleting **one known row**. A delete that is allowed to match
 * nothing — clearing a recurring event's overrides when it has none, sweeping
 * expired rows — must not use this, because zero rows is the normal answer
 * there and throwing would turn a no-op into a failure.
 */
export function assertDeleted(
  data: unknown[] | null,
  error: PostgrestError | null,
  subject: string,
): void {
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      `That ${subject} was not deleted. It may already be gone, or you may have been signed out. Reload and try again.`,
    );
  }
}
