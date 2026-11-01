import { describe, expect, test } from "vitest";
import { checkRequest, type Gate, type RequestFacts } from "../../src/server/auth/check-request.js";

const PORT = 47683;
const TOKEN = "ab".repeat(32);
const SERVER = { port: PORT, token: TOKEN };
const HOST = `127.0.0.1:${PORT}`;
const COOKIE = `grove_token=${TOKEN}`;
const SAME_ORIGIN_POST = {
  method: "POST",
  cookie: COOKIE,
  tokenHeader: TOKEN,
  origin: `http://${HOST}`,
  secFetchSite: "same-origin",
  contentType: "application/json",
};

function facts(url: string, extra: Partial<Omit<RequestFacts, "path" | "query">> = {}): RequestFacts {
  const parsed = new URL(url, "http://127.0.0.1");
  return { method: "GET", host: HOST, ...extra, path: parsed.pathname, query: parsed.searchParams };
}

function status(gate: Gate): number | string {
  return gate.kind === "deny" ? gate.status : gate.kind;
}

describe("Host", () => {
  test.each([
    ["127.0.0.1", HOST, "ok"],
    ["localhost", `localhost:${PORT}`, "ok"],
    ["a foreign name on our port", `evil.test:${PORT}`, 421],
    ["our address on another port", "127.0.0.1:1", 421],
    ["localhost on another port", "localhost:3000", 421],
    ["our address with no port", "127.0.0.1", 421],
  ])("%s gives %s", (_name, host, expected) => {
    expect(status(checkRequest(facts("/api/projects", { host, cookie: COOKIE }), SERVER))).toBe(expected);
  });

  test("a missing Host gives 421", () => {
    expect(status(checkRequest({ ...facts("/", { cookie: COOKIE }), host: undefined }, SERVER))).toBe(421);
  });

  test("a foreign Host gives 421 on a cookie-free path too", () => {
    expect(status(checkRequest(facts("/api/health", { host: `evil.test:${PORT}` }), SERVER))).toBe(421);
    expect(status(checkRequest(facts("/sw.js", { host: `evil.test:${PORT}` }), SERVER))).toBe(421);
  });
});

describe("the token in the address", () => {
  test("GET /?token=<t> sets the cookie and redirects to /", () => {
    expect(checkRequest(facts(`/?token=${TOKEN}`), SERVER)).toEqual({ kind: "set-cookie", location: "/" });
  });

  test("the redirect keeps the other query parameters", () => {
    expect(checkRequest(facts(`/?a=1&token=${TOKEN}&b=2`), SERVER)).toEqual({ kind: "set-cookie", location: "/?a=1&b=2" });
  });

  test("the redirect never leaves this server", () => {
    expect(checkRequest(facts(`/.//evil.test/?token=${TOKEN}`), SERVER)).toEqual({ kind: "set-cookie", location: "/evil.test/" });
  });

  test.each([["a wrong token", "x".repeat(64)], ["a short token", "ab"], ["an empty token", ""]])("%s gives 401", (_name, token) => {
    expect(status(checkRequest(facts(`/?token=${token}`), SERVER))).toBe(401);
  });

  test("a wrong token in the address gives 401 even with the cookie", () => {
    expect(status(checkRequest(facts("/?token=nope", { cookie: COOKIE }), SERVER))).toBe(401);
  });
});

describe("cookie-free paths", () => {
  test.each(["/manifest.webmanifest", "/sw.js", "/favicon.svg", "/icons/icon-192.png", "/fonts/mono.woff2", "/api/health"])(
    "GET %s is ok without the cookie",
    (path) => {
      expect(checkRequest(facts(path), SERVER)).toEqual({ kind: "ok" });
    },
  );

  test.each(["/", "/index.html", "/app.js", "/icons/", "/icons/..%2findex.html", "/icons/a/b.png", "/fonts/..", "/api/health/x"])(
    "GET %s needs the cookie",
    (path) => {
      expect(status(checkRequest(facts(path), SERVER))).toBe(401);
    },
  );

  test("a POST to a cookie-free path still needs the cookie", () => {
    expect(status(checkRequest(facts("/api/health", { method: "POST", tokenHeader: TOKEN }), SERVER))).toBe(401);
  });
});

describe("the cookie", () => {
  test("an API request without the cookie gives 401", () => {
    expect(status(checkRequest(facts("/api/projects"), SERVER))).toBe(401);
  });

  test("a wrong cookie gives 401", () => {
    expect(status(checkRequest(facts("/api/projects", { cookie: "grove_token=nope" }), SERVER))).toBe(401);
  });

  test("the token header alone does not stand in for the cookie", () => {
    expect(status(checkRequest(facts("/api/projects", { tokenHeader: TOKEN }), SERVER))).toBe(401);
  });

  test("the cookie is found among others, even behind a decoy of the same name", () => {
    expect(checkRequest(facts("/api/projects", { cookie: `a=1; grove_token=decoy; ${COOKIE}` }), SERVER)).toEqual({ kind: "ok" });
  });
});

describe("POST", () => {
  test("a correct POST is ok", () => {
    expect(checkRequest(facts("/api/shutdown", SAME_ORIGIN_POST), SERVER)).toEqual({ kind: "ok" });
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
    ["without X-Grove-Token", { tokenHeader: undefined }, 403],
    ["with a wrong X-Grove-Token", { tokenHeader: "x".repeat(64) }, 403],
    ["with Origin: http://localhost:3000", { origin: "http://localhost:3000" }, 403],
    ["with Origin: null", { origin: "null" }, 403],
    ["with the other allowed name as its Origin", { origin: `http://localhost:${PORT}` }, 403],
    ["with Sec-Fetch-Site: cross-site", { secFetchSite: "cross-site" }, 403],
    ["with Sec-Fetch-Site: same-site", { secFetchSite: "same-site" }, 403],
    ["with text/plain", { contentType: "text/plain" }, 415],
    ["with no content type", { contentType: undefined }, 415],
    ["without the cookie", { cookie: undefined }, 401],
  ])("a POST %s gives %s", (_name, change, expected) => {
    expect(status(checkRequest(facts("/api/shutdown", { ...SAME_ORIGIN_POST, ...change }), SERVER))).toBe(expected);
  });

  test("application/json with a charset is JSON", () => {
    const post = { ...SAME_ORIGIN_POST, contentType: "application/json; charset=utf-8" };
    expect(checkRequest(facts("/api/shutdown", post), SERVER)).toEqual({ kind: "ok" });
  });

  test("the address token is not accepted on a POST", () => {
    expect(status(checkRequest(facts(`/api/shutdown?token=${TOKEN}`, { ...SAME_ORIGIN_POST, cookie: undefined }), SERVER))).toBe(401);
  });

  test("any method but GET and HEAD is held to the POST rules", () => {
    expect(status(checkRequest(facts("/api/shutdown", { method: "DELETE", cookie: COOKIE }), SERVER))).toBe(403);
    expect(status(checkRequest(facts("/api/shutdown", { method: "OPTIONS", origin: "http://evil.test" }), SERVER))).toBe(401);
  });
});
