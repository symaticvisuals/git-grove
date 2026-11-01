import { timingSafeEqual } from "node:crypto";

export type RequestFacts = {
  method: string;
  /** The URL's pathname, still percent-encoded. */
  path: string;
  host?: string;
  tokenHeader?: string;
  origin?: string;
  secFetchSite?: string;
  contentType?: string;
};

export type Gate = { kind: "ok" } | { kind: "deny"; status: 401 | 403 | 415 | 421; reason: string };

const OK: Gate = { kind: "ok" };

function deny(status: 401 | 403 | 415 | 421, reason: string): Gate {
  return { kind: "deny", status, reason };
}

function sameToken(given: string | undefined, token: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function needsToken(path: string): boolean {
  return path === "/events" || path === "/api" || (path.startsWith("/api/") && path !== "/api/health");
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * Decides whether a request may reach the routes. Every request needs a `Host` of `127.0.0.1:<port>` or
 * `localhost:<port>` (421). A GET or HEAD of a static file or `/api/health` then passes; one of `/api/*` or `/events`
 * needs the `X-Grove-Token` header (401). Every other method needs that header (401), an `Origin` and
 * `Sec-Fetch-Site` that are same-origin when sent (403), and a JSON body (415).
 */
export function checkRequest(r: RequestFacts, server: { port: number; token: string }): Gate {
  const host = r.host?.toLowerCase();
  if (host !== `127.0.0.1:${server.port}` && host !== `localhost:${server.port}`) {
    return deny(421, "this server answers only to 127.0.0.1 and localhost");
  }
  const reading = r.method === "GET" || r.method === "HEAD";
  if (reading && !needsToken(r.path)) return OK;
  if (!sameToken(r.tokenHeader, server.token)) return deny(401, "open the dashboard from your terminal: git grove ui");
  if (reading) return OK;
  if (r.origin !== undefined && r.origin.toLowerCase() !== `http://${host}`) return deny(403, "a change must come from this dashboard");
  if (r.secFetchSite !== undefined && r.secFetchSite !== "same-origin") return deny(403, "a change must come from this dashboard");
  if (!isJson(r.contentType)) return deny(415, "a change must send application/json");
  return OK;
}
