import type { NextConfig } from "next";

/* Every response says it is not to be indexed or framed, and the page asks for no camera, microphone or location. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/* Set by scripts/package.mjs: the release download, a server with only the files it runs on. */
const BUNDLE = process.env.CRONCAL_BUNDLE === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // AGENTS.md is written by hand; `next dev` would otherwise add its own block to it.
  agentRules: false,
  /* `npm start` builds on the user's computer, where checking the types again
     proves nothing (CI checks them on every commit) and takes about half the
     build. `npm run build` still checks. */
  typescript: { ignoreBuildErrors: process.env.CRONCAL_SKIP_TYPECHECK === "1" },
  output: BUNDLE ? "standalone" : undefined,
  /* Next's image optimiser (sharp) is native, so the download would only run
     on the system it was built on, and CronCal never asks it for an image. */
  outputFileTracingExcludes: BUNDLE ? { "*": ["node_modules/sharp/**", "node_modules/@img/**"] } : undefined,
  // The setup SQL is read at request time, so a copy on the web must ship it.
  outputFileTracingIncludes: {
    "/api/selfhost/schema": ["./supabase/schema.sql"],
  },
  // The calendar is the app: "/" goes straight there, as a real redirect.
  async redirects() {
    return [{ source: "/", destination: "/calendar", permanent: false }];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
