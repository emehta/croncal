#!/usr/bin/env node
/**
 * A stand-in for the parts of Google CronCal talks to, for the end-to-end
 * test (scripts/google-e2e.mjs) and for trying Google Calendar by hand with
 * no Google account. Run CronCal with CRONCAL_GOOGLE_STAND_IN pointing here.
 *
 *   node scripts/google-stand-in.mjs [port]     default 3193
 *
 * It plays Google faithfully where CronCal could get it wrong, and simply
 * elsewhere:
 * - OAuth: the consent page approves at once and returns a code; the token
 *   endpoint checks the client, its secret, the code and the redirect URI as
 *   Google does, and refreshes and revokes tokens.
 * - Calendar: events on one calendar, kept in memory; a list by time range,
 *   with repeating events expanded into their days (`singleEvents=true`) or
 *   left whole; get, insert, patch, update and delete of an event or one day
 *   of a series; `/instances`; `iCalUID` lookups. Repeats are RRULEs of
 *   DAILY, WEEKLY (BYDAY), MONTHLY or YEARLY with INTERVAL, COUNT or UNTIL,
 *   stepped in UTC, so a series crossing a daylight saving change keeps its
 *   UTC time rather than its wall time.
 *
 * GET /__state answers with what it holds and what was asked of it, for the
 * test to check. Nothing here is a real credential.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";

export const STAND_IN = {
  clientId: "1234567890-standin.apps.googleusercontent.com",
  clientSecret: "standin-client-secret",
  email: "calendar.owner@example.com",
};

const SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";
/* Short, so CronCal's five-minute buffer refreshes on every call and the refresh path runs. */
const TOKEN_SECONDS = 120;

export function createStandIn() {
  const codes = new Map(); // code -> { redirectUri, clientId }
  const access = new Map(); // token -> refresh token it came from
  const refresh = new Set();
  const events = new Map(); // id -> event (a series is one event with `recurrence`)
  const exceptions = new Map(); // instance id -> event (a changed or cancelled day)
  const log = { authorizations: 0, exchanges: 0, refreshes: 0, revoked: [], requests: [] };

  const json = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const googleError = (response, status, reason, message = reason) =>
    json(response, status, { error: { code: status, message, errors: [{ reason, message }] } });

  function mintAccess(refreshToken) {
    const token = `standin-access-${randomUUID()}`;
    access.set(token, refreshToken);
    return token;
  }

  async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }

  // ─── Repeats ───
  const instant = (time) => (time?.dateTime ? new Date(time.dateTime) : time?.date ? new Date(`${time.date}T00:00:00Z`) : null);
  const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function parseRule(recurrence) {
    const line = (recurrence ?? []).find((entry) => entry.startsWith("RRULE:"));
    if (!line) return null;
    const parts = Object.fromEntries(line.slice(6).split(";").map((part) => part.split("=")));
    return {
      freq: parts.FREQ,
      interval: Number(parts.INTERVAL ?? 1),
      count: parts.COUNT ? Number(parts.COUNT) : null,
      until: parts.UNTIL ? new Date(parts.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z)?$/, (_, y, m, d, t, hh = "23", mm = "59", ss = "59") => `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`)) : null,
      byDay: parts.BYDAY ? parts.BYDAY.split(",") : null,
    };
  }

  /** Each start of a series, up to `limit` or `end`. */
  function occurrences(series, end, limit = 1000) {
    const rule = parseRule(series.recurrence);
    const first = instant(series.start);
    if (!rule || !first) return [];
    const starts = [];
    const day = 24 * 3600 * 1000;
    const push = (date) => {
      if (rule.until && date > rule.until) return false;
      if (end && date >= end) return false;
      starts.push(date);
      return !(rule.count && starts.length >= rule.count) && starts.length < limit;
    };
    if (rule.freq === "DAILY") {
      for (let i = 0; ; i += rule.interval) if (!push(new Date(first.getTime() + i * day))) break;
    } else if (rule.freq === "WEEKLY") {
      const wanted = rule.byDay ?? [DAYS[first.getUTCDay()]];
      const weekStart = new Date(first.getTime() - first.getUTCDay() * day);
      outer: for (let week = 0; week < 600; week += rule.interval) {
        for (let d = 0; d < 7; d += 1) {
          const date = new Date(weekStart.getTime() + (week * 7 + d) * day);
          if (date < first || !wanted.includes(DAYS[date.getUTCDay()])) continue;
          if (!push(date)) break outer;
        }
      }
    } else if (rule.freq === "MONTHLY" || rule.freq === "YEARLY") {
      for (let i = 0; i < 600; i += rule.interval) {
        const date = new Date(first);
        if (rule.freq === "MONTHLY") date.setUTCMonth(first.getUTCMonth() + i);
        else date.setUTCFullYear(first.getUTCFullYear() + i);
        if (date.getUTCDate() !== first.getUTCDate()) continue; // no 31st this month
        if (!push(date)) break;
      }
    }
    return starts;
  }

  function instance(series, start) {
    const id = `${series.id}_${stamp(start)}`;
    const changed = exceptions.get(id);
    const length = instant(series.end).getTime() - instant(series.start).getTime();
    const time = (date) => (series.start.date ? { date: date.toISOString().slice(0, 10) } : { dateTime: date.toISOString(), timeZone: series.start.timeZone });
    const base = {
      ...series,
      id,
      recurrence: undefined,
      recurringEventId: series.id,
      originalStartTime: time(start),
      start: time(start),
      end: time(new Date(start.getTime() + length)),
    };
    return changed ? { ...base, ...changed, id, recurringEventId: series.id, originalStartTime: base.originalStartTime } : base;
  }

  function findEvent(id) {
    if (events.has(id)) return events.get(id);
    const [seriesId, when] = id.split("_");
    const series = events.get(seriesId);
    if (!series || !when) return null;
    const start = occurrences(series, null).find((date) => stamp(date) === when);
    return start ? instance(series, start) : null;
  }

  function listItems(params) {
    const from = params.get("timeMin") ? new Date(params.get("timeMin")) : null;
    const to = params.get("timeMax") ? new Date(params.get("timeMax")) : null;
    const single = params.get("singleEvents") === "true";
    const showDeleted = params.get("showDeleted") === "true";
    const uid = params.get("iCalUID");
    const overlaps = (event) => {
      const start = instant(event.start);
      const end = instant(event.end);
      return (!to || start < to) && (!from || end > from);
    };
    const items = [];
    for (const event of events.values()) {
      if (uid && event.iCalUID !== uid) continue;
      if (event.recurrence && single) {
        for (const start of occurrences(event, to)) {
          const day = instance(event, start);
          if ((day.status !== "cancelled" || showDeleted) && overlaps(day)) items.push(day);
        }
      } else if ((event.status !== "cancelled" || showDeleted) && (event.recurrence || overlaps(event))) {
        items.push(event);
      }
    }
    if (uid && !single) for (const [id, changed] of exceptions) if (changed.iCalUID === uid) items.push(findEvent(id));
    return items.sort((a, b) => instant(a.start) - instant(b.start));
  }

  function saveEvent(id, next) {
    if (events.has(id)) {
      events.set(id, { ...next, updated: new Date().toISOString(), etag: `"${randomUUID()}"` });
      return events.get(id);
    }
    exceptions.set(id, { ...next, updated: new Date().toISOString() });
    return findEvent(id);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://stand-in");
    const path = url.pathname;
    log.requests.push(`${request.method} ${path}`);

    if (path === "/__state") {
      return json(response, 200, { ...log, events: [...events.values()], exceptions: Object.fromEntries(exceptions), access: access.size });
    }

    // ─── OAuth ───
    if (path === "/o/oauth2/v2/auth") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const clientId = url.searchParams.get("client_id");
      if (clientId !== STAND_IN.clientId || !redirectUri) return googleError(response, 400, "invalid_client");
      if (!(url.searchParams.get("scope") ?? "").includes("calendar")) return googleError(response, 400, "invalid_scope");
      log.authorizations += 1;
      const code = `standin-code-${randomUUID()}`;
      codes.set(code, { redirectUri, clientId });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      back.searchParams.set("scope", SCOPE);
      response.writeHead(302, { location: back.toString() });
      return response.end();
    }
    if (path === "/token" && request.method === "POST") {
      const form = new URLSearchParams(await readBody(request));
      if (form.get("client_id") !== STAND_IN.clientId || form.get("client_secret") !== STAND_IN.clientSecret) {
        return json(response, 401, { error: "invalid_client" });
      }
      if (form.get("grant_type") === "authorization_code") {
        const grant = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (!grant || grant.redirectUri !== form.get("redirect_uri")) return json(response, 400, { error: "invalid_grant" });
        log.exchanges += 1;
        const refreshToken = `standin-refresh-${randomUUID()}`;
        refresh.add(refreshToken);
        return json(response, 200, { access_token: mintAccess(refreshToken), refresh_token: refreshToken, expires_in: TOKEN_SECONDS, scope: SCOPE, token_type: "Bearer" });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (!refresh.has(form.get("refresh_token"))) return json(response, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        log.refreshes += 1;
        return json(response, 200, { access_token: mintAccess(form.get("refresh_token")), expires_in: TOKEN_SECONDS, scope: SCOPE, token_type: "Bearer" });
      }
      return json(response, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/revoke" && request.method === "POST") {
      const token = url.searchParams.get("token");
      log.revoked.push(token);
      refresh.delete(token);
      for (const [key, from] of access) if (key === token || from === token) access.delete(key);
      return json(response, 200, {});
    }
    if (path === "/tokeninfo") {
      const token = url.searchParams.get("access_token");
      return access.has(token) ? json(response, 200, { scope: SCOPE, expires_in: TOKEN_SECONDS }) : json(response, 400, { error: "invalid_token" });
    }

    // Everything below needs a live access token.
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!access.has(bearer)) return googleError(response, 401, "authError", "Invalid Credentials");

    if (path === "/oauth2/v2/userinfo") return json(response, 200, { email: STAND_IN.email, verified_email: true });

    // ─── Calendar ───
    const prefix = "/calendar/v3/calendars/primary/events";
    if (!path.startsWith(prefix)) return googleError(response, 404, "notFound");
    const [, id, sub] = path.slice(prefix.length).split("/").map(decodeURIComponent);

    if (!id) {
      if (request.method === "GET") return json(response, 200, { kind: "calendar#events", items: listItems(url.searchParams) });
      if (request.method === "POST") {
        const body = JSON.parse((await readBody(request)) || "{}");
        if (!body.start || !body.end) return googleError(response, 400, "required", "Missing start or end.");
        // An id of the caller's own, as Google takes one, and refuses again once it is used.
        if (body.id !== undefined && !/^[a-v0-9]{5,1024}$/.test(String(body.id))) return googleError(response, 400, "invalid", "Invalid resource id value.");
        if (body.id !== undefined && events.has(body.id)) return googleError(response, 409, "duplicate", "The requested identifier already exists.");
        const newId = body.id ?? randomUUID().replace(/-/g, "");
        const now = new Date().toISOString();
        const event = { kind: "calendar#event", status: "confirmed", ...body, id: newId, iCalUID: `${newId}@google.com`, created: now, updated: now, etag: `"${randomUUID()}"`, htmlLink: `https://calendar.google.com/event?eid=${newId}`, organizer: { email: STAND_IN.email, self: true } };
        events.set(newId, event);
        return json(response, 200, event);
      }
    }

    const event = findEvent(id);
    if (!event) return googleError(response, 404, "notFound", "Not Found");
    if (sub === "instances") {
      const original = url.searchParams.get("originalStart");
      const series = events.get(id);
      const days = series ? occurrences(series, null).map((start) => instance(series, start)) : [];
      const shown = days.filter((day) => url.searchParams.get("showDeleted") === "true" || day.status !== "cancelled");
      return json(response, 200, { items: original ? shown.filter((day) => instant(day.originalStartTime).getTime() === new Date(original).getTime()) : shown });
    }
    if (request.method === "GET") return json(response, 200, event);
    if (request.method === "PATCH" || request.method === "PUT") {
      const body = JSON.parse((await readBody(request)) || "{}");
      const merged = request.method === "PUT" ? { ...body } : { ...event, ...body };
      if (body.extendedProperties?.private && request.method === "PATCH") {
        const kept = { ...(event.extendedProperties?.private ?? {}) };
        for (const [key, value] of Object.entries(body.extendedProperties.private)) {
          if (value === null) delete kept[key];
          else kept[key] = value;
        }
        merged.extendedProperties = { ...event.extendedProperties, private: kept };
      }
      return json(response, 200, saveEvent(id, { ...merged, id }));
    }
    if (request.method === "DELETE") {
      if (events.has(id)) events.delete(id);
      else exceptions.set(id, { ...event, status: "cancelled" });
      response.writeHead(204);
      return response.end();
    }
    return googleError(response, 405, "methodNotAllowed");
  });

  return { server, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 3193);
  createStandIn().server.listen(port, "127.0.0.1", () => {
    console.log(`Google stand-in on http://127.0.0.1:${port}\nClient ID: ${STAND_IN.clientId}\nClient secret: ${STAND_IN.clientSecret}`);
  });
}
