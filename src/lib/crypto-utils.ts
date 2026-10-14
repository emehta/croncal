import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Constant-time checks for the server's shared secrets and signed values.
 * Server only: node:crypto is not in a browser bundle, and nothing here should be.
 */

/** Constant-time comparison, so a secret cannot be recovered a byte at a time. */
export function secretsMatch(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The token from an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = header?.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

/**
 * The subject a JWT names, read without checking its signature.
 *
 * Only for starting a read early, beside the check that proves the token:
 * whatever it starts is used only when the verified user is this one, and
 * thrown away otherwise.
 */
export function unverifiedJwtSubject(token: string | null | undefined): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const subject = claims !== null && typeof claims === "object" ? (claims as { sub?: unknown }).sub : null;
    return typeof subject === "string" && subject !== "" ? subject : null;
  } catch {
    return null;
  }
}

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
