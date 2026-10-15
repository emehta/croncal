import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";
import { APP } from "@/selfhost/constants";

/**
 * Says which app answers on this port, and its version, so `npm start` can
 * tell this app already running from another program, and an older copy
 * still running from this one.
 */
export function GET() {
  return NextResponse.json({ app: APP, version: packageJson.version }, { headers: { "cache-control": "no-store" } });
}
