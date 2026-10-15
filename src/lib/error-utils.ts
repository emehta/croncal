type ErrorShape = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Whether an error is a cancelled fetch rather than a real failure.
 *
 * Aborts arrive in more than one shape depending on where they are caught (a
 * DOMException from fetch, a plain Error from Supabase's client), so all of
 * them are checked here instead of in each caller.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown };
    return (
      value.name === "AbortError" ||
      (typeof value.message === "string" && value.message.toLowerCase().includes("abort"))
    );
  }
  return false;
}

/** Everything an error says, joined: its message, and Supabase's details, hint and code. */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const shaped = error as ErrorShape;
    return [
      asText(shaped.message),
      asText(shaped.details),
      asText(shaped.hint),
      asText(shaped.code) ? `Code: ${String(shaped.code)}` : null,
    ].filter(Boolean).join(" ");
  }
  return "";
}

const NETWORK = /failed to fetch|networkerror|load failed|network request failed/i;

/** What a person is told when the server could not be reached at all: the one offline message, everywhere. */
export const OFFLINE_MESSAGE = "Check you're online, then try again.";

/**
 * An error in words for a banner. A dropped connection says so plainly:
 * Supabase's client reports it as "TypeError: Failed to fetch" with a stack
 * trace in its details, which would show in the banner word for word.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  const text = errorText(error);
  if (NETWORK.test(text)) return OFFLINE_MESSAGE;
  return text || fallback;
}

/**
 * Whether an error is the browser failing to reach the server at all: a
 * dropped connection, offline, a blocked request. Chrome says "Failed to
 * fetch", Firefox "NetworkError" and Safari "Load failed".
 */
export function isNetworkError(error: unknown): boolean {
  return NETWORK.test(errorText(error));
}
