import { timingSafeEqual } from "node:crypto";

export type RequestFacts = {
  method: string;
  /** The URL's pathname, still percent-encoded. */
  path: string;
  query: URLSearchParams;
  host?: string;
  cookie?: string;
  tokenHeader?: string;
  origin?: string;
  secFetchSite?: string;
  contentType?: string;
};

export type Gate =
  | { kind: "ok" }
  | { kind: "set-cookie"; location: string }
  | { kind: "deny"; status: 401 | 403 | 415 | 421; reason: string };

const COOKIE_NAME = "grove_token";
const COOKIE_FREE_FILES = new Set(["/manifest.webmanifest", "/sw.js", "/favicon.svg", "/api/health"]);
const COOKIE_FREE_FOLDER = /^\/(?:icons|fonts)\/(?!\.\.?$)[\w.-]+$/;
const OK: Gate = { kind: "ok" };

function deny(status: 401 | 403 | 415 | 421, reason: string): Gate {
  return { kind: "deny", status, reason };
}

function sameToken(given: string | null | undefined, token: string): boolean {
  if (given === null || given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieHolds(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  return header.split(";").some((pair) => {
    const at = pair.indexOf("=");
    return at !== -1 && pair.slice(0, at).trim() === COOKIE_NAME && sameToken(pair.slice(at + 1).trim(), token);
  });
}

function withoutToken(path: string, query: URLSearchParams): string {
  const rest = new URLSearchParams(query);
  rest.delete("token");
  const search = rest.toString();
  return `/${path.replace(/^[/\\]+/, "")}${search === "" ? "" : `?${search}`}`;
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * Decides whether a request may reach the routes. Every request needs a `Host` of `127.0.0.1:<port>` or
 * `localhost:<port>` (421). A GET or HEAD of a cookie-free asset or `/api/health` then passes; a GET or HEAD
 * carrying `?token=` swaps it for the cookie or is 401; anything else needs the `grove_token` cookie (401).
 * Every other method also needs the `X-Grove-Token` header (403), an `Origin` and `Sec-Fetch-Site` that are
 * same-origin when sent (403), and a JSON body (415).
 */
export function checkRequest(r: RequestFacts, server: { port: number; token: string }): Gate {
  const host = r.host?.toLowerCase();
  if (host !== `127.0.0.1:${server.port}` && host !== `localhost:${server.port}`) {
    return deny(421, "this server answers only to 127.0.0.1 and localhost");
  }
  const reading = r.method === "GET" || r.method === "HEAD";
  if (reading && (COOKIE_FREE_FILES.has(r.path) || COOKIE_FREE_FOLDER.test(r.path))) return OK;
  if (reading && r.query.has("token")) {
    return sameToken(r.query.get("token"), server.token)
      ? { kind: "set-cookie", location: withoutToken(r.path, r.query) }
      : deny(401, "that link's token is not this server's; open the dashboard with git grove ui");
  }
  if (!cookieHolds(r.cookie, server.token)) return deny(401, "open the dashboard with git grove ui");
  if (reading) return OK;
  if (!sameToken(r.tokenHeader, server.token)) return deny(403, "a change needs the X-Grove-Token header");
  if (r.origin !== undefined && r.origin.toLowerCase() !== `http://${host}`) return deny(403, "a change must come from this dashboard");
  if (r.secFetchSite !== undefined && r.secFetchSite !== "same-origin") return deny(403, "a change must come from this dashboard");
  if (!isJson(r.contentType)) return deny(415, "a change must send application/json");
  return OK;
}
