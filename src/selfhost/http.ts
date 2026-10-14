import { NextResponse } from "next/server";
import { SetupError } from "@/selfhost/server";

/** Small helpers for the setup routes. Server only. */

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export function ok(body: Record<string, unknown> = { ok: true }) {
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

/** A body that is not a JSON object is the caller's mistake, never a 500. */
export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value.trim() : "";
}

const MIN_PASSWORD = 8;
/* Supabase hashes a password with bcrypt, which reads 72 bytes and refuses more. */
const MAX_PASSWORD_BYTES = 72;

/** What is wrong with a new password, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Choose a password of ${MIN_PASSWORD} characters or more.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return "That password is too long.";
  return null;
}

export function fromError(error: unknown) {
  if (error instanceof SetupError) {
    const code = (error as { code?: unknown }).code;
    return NextResponse.json(
      typeof code === "string" ? { error: error.message, code } : { error: error.message },
      { status: error.status, headers: { "cache-control": "no-store" } },
    );
  }
  console.error(error);
  return fail("Something went wrong on this computer's side. Try again.", 500);
}
