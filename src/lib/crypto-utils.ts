import { createHmac } from "node:crypto";
import { secretsMatch } from "@/selfhost/compare";

/*
 * Signed values for the Google connect cookies. Server only: node:crypto is
 * not in a browser bundle, and nothing here should be.
 */

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * `value.signature`, an HMAC over the value.
 *
 * For a value the server hands the browser and must be able to trust when it
 * comes back, such as whose OAuth attempt a callback belongs to. The browser
 * can read it, so it must not be secret; it cannot change it without the
 * signature failing.
 */
export function signValue(value: string, secret: string): string {
  if (!secret) throw new Error("A signing secret is required.");
  return `${value}.${signature(value, secret)}`;
}

/** The value inside a signed string, or null if it was altered or is malformed. */
export function verifySignedValue(signed: string | null | undefined, secret: string): string | null {
  if (!signed || !secret) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  return secretsMatch(signed.slice(dot + 1), signature(value, secret)) ? value : null;
}
