import { NextResponse, type NextRequest } from "next/server";

/**
 * A copy on someone's computer answers this computer only.
 *
 * - A request whose Host is not this computer's own loopback name is a page
 *   elsewhere pointing a name of its own at it (DNS rebinding): refused.
 * - The app has one address, http://localhost:PORT, the one npm start
 *   opens: a page opened on 127.0.0.1 or [::1] is moved there, so there is one
 *   sign-in and one saved session (the browser keeps them per address). Not
 *   with an HTTP redirect: Next reads every loopback name as "localhost",
 *   takes a redirect between them for one to its own origin, and cuts its
 *   Location down to a bare path, which the browser follows back to where it
 *   was, forever, whichever way round. A small page that moves the browser
 *   itself is not rewritten.
 * - A write must come from the app's own pages: its Origin is the app's,
 *   the browser says it is same-origin, and it is JSON. A page on another
 *   site can post to localhost, and this is what stops it.
 *
 * A copy on the web (Vercel) has its own domain and HTTPS, and is left alone.
 */

const APP_HOST = "localhost";
const OTHER_LOOPBACKS = new Set(["127.0.0.1", "[::1]"]);

function splitHost(host: string): { name: string; port: string } {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return { name: host.slice(0, end + 1), port: host.slice(end + 2) };
  }
  const [name, port = ""] = host.split(":");
  return { name, port };
}

/** A page that sends the browser to `target` at once, with a link if scripts are off. */
function moveTo(target: string): NextResponse {
  const safe = JSON.stringify(target).replace(/</g, "\\u003c");
  const attribute = target.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attribute}"><title>CronCal</title><script>location.replace(${safe})</script><a href="${attribute}">Open CronCal</a>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export function proxy(request: NextRequest) {
  if (process.env.VERCEL) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  const { name, port } = splitHost(host);
  const { pathname, search } = request.nextUrl;

  const loopback = name === APP_HOST || OTHER_LOOPBACKS.has(name);
  if (!loopback) return new NextResponse("This app only answers this computer.", { status: 421 });

  const method = request.method.toUpperCase();
  const reading = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (name !== APP_HOST && reading && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    return moveTo(`http://${APP_HOST}${port ? `:${port}` : ""}${pathname}${search}`);
  }

  if (reading) return NextResponse.next();

  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== `http://${host}` || (site !== null && site !== "same-origin")) {
    return NextResponse.json({ error: "Requests from other sites are refused." }, { status: 403 });
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) {
    return NextResponse.json({ error: "Send JSON." }, { status: 415 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
