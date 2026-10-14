import { createHash, timingSafeEqual } from "node:crypto";

/** Compares two secrets in constant time, whatever their lengths. Server only. */
export function secretsMatch(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}
