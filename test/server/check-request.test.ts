import { describe, expect, test } from "vitest";
import { checkRequest, type Gate, type RequestFacts } from "../../src/server/auth/check-request.js";

const PORT = 47683;
const TOKEN = "ab".repeat(32);
const SERVER = { port: PORT, token: TOKEN };
const HOST = `127.0.0.1:${PORT}`;
const SAME_ORIGIN_POST = {
  method: "POST",
  tokenHeader: TOKEN,
  origin: `http://${HOST}`,
  secFetchSite: "same-origin",
  contentType: "application/json",
};
const PUBLIC_PATHS = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/fonts/mono.woff2",
  "/api/health",
];

function facts(url: string, extra: Partial<Omit<RequestFacts, "path">> = {}): RequestFacts {
  return { method: "GET", host: HOST, ...extra, path: new URL(url, "http://127.0.0.1").pathname };
}

function status(gate: Gate): number | string {
  return gate.kind === "deny" ? gate.status : gate.kind;
}

describe("Host", () => {
  test.each([
    ["127.0.0.1", "ok", HOST],
    ["localhost", "ok", `localhost:${PORT}`],
    ["the IPv6 loopback", "ok", `[::1]:${PORT}`],
    ["the IPv6 loopback on another port", 421, "[::1]:1"],
    ["the IPv6 loopback with no port", 421, "[::1]"],
    ["a foreign name on our port", 421, `evil.test:${PORT}`],
    ["our address on another port", 421, "127.0.0.1:1"],
    ["localhost on another port", 421, "localhost:3000"],
    ["our address with no port", 421, "127.0.0.1"],
  ])("%s gives %s", (_name, expected, host) => {
    expect(status(checkRequest(facts("/api/projects", { host, tokenHeader: TOKEN }), SERVER))).toBe(expected);
  });

  test("a missing Host gives 421", () => {
    expect(status(checkRequest({ ...facts("/"), host: undefined }, SERVER))).toBe(421);
  });

  test.each(["/", "/app.js", "/api/health", "/sw.js"])("a foreign Host gives 421 on the public %s too", (path) => {
    expect(status(checkRequest(facts(path, { host: `evil.test:${PORT}` }), SERVER))).toBe(421);
  });
});

describe("public files", () => {
  test.each(PUBLIC_PATHS)("GET %s needs no token", (path) => {
    expect(checkRequest(facts(path), SERVER)).toEqual({ kind: "ok" });
  });

  test("a token in the query string does not stand in for the header", () => {
    expect(status(checkRequest(facts(`/api/projects?token=${TOKEN}`), SERVER))).toBe(401);
  });
});

describe("the token header", () => {
  test.each(["/api/projects", "/api/features/x", "/api", "/events"])("GET %s without X-Grove-Token gives 401", (path) => {
    expect(status(checkRequest(facts(path), SERVER))).toBe(401);
  });

  test.each(["/api/projects", "/events"])("GET %s with X-Grove-Token is ok", (path) => {
    expect(checkRequest(facts(path, { tokenHeader: TOKEN }), SERVER)).toEqual({ kind: "ok" });
  });

  test.each([["a wrong token", "x".repeat(64)], ["a short token", "ab"], ["an empty token", ""]])("%s gives 401", (_name, token) => {
    expect(status(checkRequest(facts("/api/projects", { tokenHeader: token }), SERVER))).toBe(401);
  });
});

describe("POST", () => {
  test("a correct POST is ok", () => {
    expect(checkRequest(facts("/api/shutdown", SAME_ORIGIN_POST), SERVER)).toEqual({ kind: "ok" });
  });

  test("a correct POST through the IPv6 loopback is ok", () => {
    const host = `[::1]:${PORT}`;
    expect(checkRequest(facts("/api/shutdown", { ...SAME_ORIGIN_POST, host, origin: `http://${host}` }), SERVER)).toEqual({ kind: "ok" });
  });

  test("a correct POST through localhost is ok", () => {
    const host = `localhost:${PORT}`;
    expect(checkRequest(facts("/api/shutdown", { ...SAME_ORIGIN_POST, host, origin: `http://${host}` }), SERVER)).toEqual({ kind: "ok" });
  });

  test("a POST from a client that sends no Origin or Sec-Fetch-Site is ok", () => {
    const post = { ...SAME_ORIGIN_POST, origin: undefined, secFetchSite: undefined };
    expect(checkRequest(facts("/api/shutdown", post), SERVER)).toEqual({ kind: "ok" });
  });

  test.each([
    ["without X-Grove-Token", 401, { tokenHeader: undefined }],
    ["with a wrong X-Grove-Token", 401, { tokenHeader: "x".repeat(64) }],
    ["with Origin: http://localhost:3000", 403, { origin: "http://localhost:3000" }],
    ["with Origin: null", 403, { origin: "null" }],
    ["with the other allowed name as its Origin", 403, { origin: `http://localhost:${PORT}` }],
    ["with Sec-Fetch-Site: cross-site", 403, { secFetchSite: "cross-site" }],
    ["with Sec-Fetch-Site: same-site", 403, { secFetchSite: "same-site" }],
    ["with text/plain", 415, { contentType: "text/plain" }],
    ["with no content type", 415, { contentType: undefined }],
  ])("a POST %s gives %s", (_name, expected, change) => {
    expect(status(checkRequest(facts("/api/shutdown", { ...SAME_ORIGIN_POST, ...change }), SERVER))).toBe(expected);
  });

  test("application/json with a charset is JSON", () => {
    const post = { ...SAME_ORIGIN_POST, contentType: "application/json; charset=utf-8" };
    expect(checkRequest(facts("/api/shutdown", post), SERVER)).toEqual({ kind: "ok" });
  });

  test.each(["/api/health", "/"])("a POST to the public %s still needs the token", (path) => {
    expect(status(checkRequest(facts(path, { ...SAME_ORIGIN_POST, tokenHeader: undefined }), SERVER))).toBe(401);
  });

  test("any method but GET and HEAD is held to the POST rules", () => {
    expect(status(checkRequest(facts("/api/shutdown", { method: "DELETE", tokenHeader: TOKEN }), SERVER))).toBe(415);
    expect(status(checkRequest(facts("/api/shutdown", { method: "OPTIONS", origin: "http://evil.test" }), SERVER))).toBe(401);
  });
});
