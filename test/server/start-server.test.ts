import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PortsInUseError } from "../../src/server/http/ports-in-use.error.js";
import { ServerRunningError } from "../../src/server/server-running.error.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { serverRequest } from "../support/server-request.js";
import { type UiFixture, uiFixture } from "../support/ui-fixture.js";

const VERSION = "9.9.9";
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "cache-control": "no-store",
};

const ipv6 = await new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

let home: string;
let ui: UiFixture;
let servers: RunningServer[];
let blockers: Server[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-server-"));
  ui = await uiFixture();
  servers = [];
  blockers = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(blockers.map((blocker) => new Promise((resolve) => blocker.close(resolve))));
  await rm(home, { recursive: true, force: true });
  await ui.cleanup();
});

async function start(options: { port?: number; home?: string; onShutdown?: (code: number) => void } = {}): Promise<RunningServer> {
  const server = await startServer({ port: 0, home, uiDir: ui.dir, version: VERSION, ...options });
  servers.push(server);
  return server;
}

function occupy(port: number, host = "127.0.0.1"): Promise<Server | null> {
  const blocker = createServer();
  return new Promise((resolve) => {
    blocker.once("error", () => resolve(null));
    blocker.listen(port, host, () => {
      blockers.push(blocker);
      resolve(blocker);
    });
  });
}

async function occupyFreePort(host = "127.0.0.1"): Promise<number> {
  const blocker = await occupy(0, host);
  const address = blocker?.address();
  if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
  return address.port;
}

function tokenOf(server: RunningServer): Record<string, string> {
  return { "x-grove-token": server.token };
}

function post(server: RunningServer, path: string, headers: Record<string, string> = {}, body = "{}"): Promise<Response> {
  return fetch(`${server.url}${path.slice(1)}`, {
    method: "POST",
    headers: { ...tokenOf(server), "content-type": "application/json", ...headers },
    body,
  });
}

function serverFile(): string {
  return join(home, "server.json");
}

test("records pid, port and version in server.json and serves /api/health", async () => {
  const server = await start();
  expect(server.port).toBeGreaterThan(0);
  expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
  expect(JSON.parse(await readFile(serverFile(), "utf8"))).toEqual({ pid: process.pid, port: server.port, version: VERSION });
  const health = await fetch(`${server.url}api/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true, version: VERSION, pid: process.pid });
});

test("the token is the one in the token file", async () => {
  const server = await start();
  expect(server.token).toMatch(/^[0-9a-f]{64}$/);
  expect(await readFile(join(home, "token"), "utf8")).toBe(server.token);
  expect(server.context.token).toBe(server.token);
  expect(server.context.port).toBe(server.port);
  expect(server.context.home).toBe(home);
});

test("an existing home folder open to others is narrowed to 0700", async () => {
  const shared = join(home, "shared");
  await mkdir(shared);
  await chmod(shared, 0o755);
  await start({ home: shared });
  expect((await stat(shared)).mode & 0o777).toBe(0o700);
});

test("a second server with the same home refuses while the first runs", async () => {
  const first = await start();
  const second = start();
  await expect(second).rejects.toBeInstanceOf(ServerRunningError);
  await expect(second).rejects.toMatchObject({ port: first.port, pid: process.pid, url: first.url });
  expect(JSON.parse(await readFile(serverFile(), "utf8"))).toMatchObject({ port: first.port });
});

test("takes the next port when the asked one is busy", async () => {
  const busy = await occupyFreePort();
  const server = await start({ port: busy });
  expect(server.port).toBe(busy + 1);
});

test.skipIf(!ipv6)("listens on [::1] at the same port as 127.0.0.1", async () => {
  const server = await start();
  const viaIpv6 = await serverRequest(server.port, { address: "::1", path: "/api/health", headers: { host: `localhost:${server.port}` } });
  expect(viaIpv6.status).toBe(200);
  expect(JSON.parse(viaIpv6.body)).toMatchObject({ pid: process.pid });
  await server.close();
  await expect(serverRequest(server.port, { address: "::1", path: "/api/health" })).rejects.toThrow();
});

test.skipIf(!ipv6)("answers a Host of [::1] at its own port, and refuses [::1] at any other", async () => {
  const server = await start();
  const own = await serverRequest(server.port, { address: "::1", path: "/api/health", headers: { host: `[::1]:${server.port}` } });
  expect(own.status).toBe(200);
  expect(JSON.parse(own.body)).toEqual({ ok: true, version: VERSION, pid: process.pid });
  const other = await serverRequest(server.port, { address: "::1", path: "/api/health", headers: { host: `[::1]:${server.port + 1}` } });
  expect(other.status).toBe(421);
});

test.skipIf(!ipv6)("takes the next port when [::1] at the asked one is busy", async () => {
  const busy = await occupyFreePort("::1");
  const server = await start({ port: busy });
  expect(server.port).toBe(busy + 1);
  await expect(fetch(`http://127.0.0.1:${busy}/api/health`)).rejects.toThrow();
});

test("every port in the range being busy is a PortsInUseError, and nothing is left behind", async () => {
  let base = 0;
  for (let attempt = 0; attempt < 10 && base === 0; attempt++) {
    const candidate = await occupyFreePort();
    const rest = await Promise.all(Array.from({ length: 19 }, (_, i) => occupy(candidate + 1 + i)));
    if (rest.every((blocker) => blocker !== null)) base = candidate;
  }
  expect(base).toBeGreaterThan(0);
  await expect(start({ port: base })).rejects.toBeInstanceOf(PortsInUseError);
  expect(existsSync(serverFile())).toBe(false);
  expect(existsSync(join(home, "server.lock"))).toBe(false);
});

test("/ serves index.html with the version, no token, a CSP and no-store, without the token header", async () => {
  const server = await start();
  const res = await fetch(server.url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  const body = await res.text();
  expect(body).toContain(`<meta name="grove-version" content="${VERSION}">`);
  expect(body).not.toContain(server.token);
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("/Index.html and any other page carry the CSP too", async () => {
  const server = await start();
  for (const path of ["/Index.html", "/other.html", "/index.html"]) {
    const res = await fetch(`${server.url}${path.slice(1)}`);
    expect(res.headers.get("content-security-policy"), path).toContain("script-src 'self'");
    if (res.status === 200) expect(await res.text(), path).not.toContain("%GROVE_VERSION%");
  }
});

test("static files return 200 without the token header", async () => {
  const server = await start();
  const cases: [string, string][] = [
    ["app.js", "text/javascript; charset=utf-8"],
    ["manifest.webmanifest", "application/manifest+json"],
    ["sw.js", "text/javascript; charset=utf-8"],
    ["favicon.svg", "image/svg+xml"],
    ["icons/icon-192.png", "image/png"],
    ["fonts/mono.woff2", "font/woff2"],
  ];
  for (const [path, type] of cases) {
    const res = await fetch(`${server.url}${path}`);
    expect(res.status, path).toBe(200);
    expect(res.headers.get("content-type"), path).toBe(type);
  }
});

test("API calls without the token header are 401, and with it they pass the gate", async () => {
  const server = await start();
  for (const path of ["api/unrouted", "events"]) {
    expect((await fetch(`${server.url}${path}`)).status, path).toBe(401);
    expect((await fetch(`${server.url}${path}`, { headers: { "x-grove-token": "f".repeat(64) } })).status, path).toBe(401);
  }
  expect((await fetch(`${server.url}api/unrouted`, { headers: tokenOf(server) })).status).toBe(404);
  const stream = await fetch(`${server.url}events`, { headers: tokenOf(server) });
  expect(stream.status).toBe(200);
  await stream.body?.cancel();
  expect((await fetch(`${server.url}api/projects?token=${server.token}`)).status).toBe(401);
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);
});

test("every response carries the security headers and the CSP", async () => {
  const server = await start();
  const replies = [
    await fetch(server.url),
    await fetch(`${server.url}api/health`),
    await fetch(`${server.url}api/nope`),
    await fetch(`${server.url}api/nope`, { headers: tokenOf(server) }),
    await fetch(`${server.url}sw.js`),
    await fetch(`${server.url}nope.js`),
    await post(server, "/api/shutdown", { "content-type": "text/plain" }),
  ];
  for (const res of replies) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name), `${res.url} ${name}`).toBe(value);
    expect(res.headers.get("content-security-policy"), res.url).toContain("frame-ancestors 'none'");
  }
  const rebound = await serverRequest(server.port, { headers: { host: `evil.test:${server.port}` } });
  expect(rebound.headers).toMatchObject(SECURITY_HEADERS);
  expect(rebound.headers["content-security-policy"]).toContain("default-src 'self'");
});

test("no response sets a cookie", async () => {
  const server = await start();
  for (const res of [await fetch(server.url), await fetch(`${server.url}?token=${server.token}`), await fetch(`${server.url}api/health`)]) {
    expect(res.headers.get("set-cookie")).toBeNull();
  }
});

test("a rebound Host is 421, even with the token header", async () => {
  const server = await start();
  const rebound = await serverRequest(server.port, { path: "/api/nope", headers: { host: `evil.test:${server.port}`, ...tokenOf(server) } });
  expect(rebound.status).toBe(421);
  for (const path of ["/", "/api/health"]) {
    expect((await serverRequest(server.port, { path, headers: { host: `evil.test:${server.port}` } })).status, path).toBe(421);
  }
  const localhost = await serverRequest(server.port, { path: "/api/health", headers: { host: `localhost:${server.port}` } });
  expect(localhost.status).toBe(200);
});

test("a request target that does not parse is 400 and is not logged", async () => {
  const server = await start();
  const write = vi.spyOn(process.stderr, "write");
  const res = await serverRequest(server.port, { path: "//" });
  expect(res.status).toBe(400);
  expect(write).not.toHaveBeenCalled();
});

test("POST /api/shutdown needs the header, then closes the server and calls onShutdown(75)", async () => {
  let resolveCode: (code: number) => void = () => undefined;
  const stopped = new Promise<number>((resolve) => (resolveCode = resolve));
  const server = await start({ onShutdown: (code) => resolveCode(code) });

  const refused = await fetch(`${server.url}api/shutdown`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(refused.status).toBe(401);
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);

  const accepted = await post(server, "/api/shutdown");
  expect(accepted.status).toBe(202);
  expect(await stopped).toBe(75);
  await expect(fetch(`${server.url}api/health`)).rejects.toThrow();
  expect(existsSync(serverFile())).toBe(false);
  expect(existsSync(join(home, "server.lock"))).toBe(false);
});

test("GET /api/shutdown changes nothing", async () => {
  const server = await start();
  const res = await fetch(`${server.url}api/shutdown`, { headers: tokenOf(server) });
  expect(res.status).toBe(404);
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);
});

test("a JSON body over 64 KB is 413 and malformed JSON is 400, and neither runs the route", async () => {
  const server = await start();
  const big = await post(server, "/api/shutdown", {}, JSON.stringify({ pad: "x".repeat(70 * 1024) }));
  expect(big.status).toBe(413);
  const malformed = await post(server, "/api/shutdown", {}, "{");
  expect(malformed.status).toBe(400);
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);
});

test("a chunked body that grows past 64 KB is 413 without a content-length to go on", async () => {
  const server = await start();
  const res = await serverRequest(server.port, {
    method: "POST",
    path: "/api/shutdown",
    headers: { ...tokenOf(server), "content-type": "application/json", "transfer-encoding": "chunked" },
    body: JSON.stringify({ pad: "x".repeat(70 * 1024) }),
  });
  expect(res.status).toBe(413);
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);
});

test("a body declared over 64 KB is 413 before any of it arrives", async () => {
  const server = await start();
  const reply = await new Promise<string>((resolve, reject) => {
    const socket = connect(server.port, "127.0.0.1");
    let text = "";
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(text);
      }
    });
    socket.on("error", reject);
    const headers = [
      "POST /api/shutdown HTTP/1.1",
      `Host: 127.0.0.1:${server.port}`,
      `X-Grove-Token: ${server.token}`,
      "Content-Type: application/json",
      `Content-Length: ${1024 * 1024}`,
    ];
    socket.write(`${headers.join("\r\n")}\r\n\r\n{`);
  });
  expect(reply.split("\r\n")[0]).toBe("HTTP/1.1 413 Payload Too Large");
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);
});

test("no response carries Access-Control-Allow-Origin", async () => {
  const server = await start();
  const evil = { origin: "http://evil.test" };
  const replies = [
    await fetch(`${server.url}api/health`, { headers: evil }),
    await fetch(server.url, { headers: evil }),
    await fetch(`${server.url}api/projects`, { headers: evil }),
    await post(server, "/api/shutdown", evil),
    await fetch(`${server.url}api/shutdown`, {
      method: "OPTIONS",
      headers: { ...evil, "access-control-request-method": "POST", "access-control-request-headers": "x-grove-token" },
    }),
  ];
  for (const res of replies) {
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  }
  expect(replies[3]?.status).toBe(403);
  expect((await fetch(`${server.url}api/health`)).status).toBe(200);
});

test("a path that climbs out of the ui folder is 404", async () => {
  const server = await start();
  const secret = join(ui.dir, "..", "secret.txt");
  await writeFile(secret, "secret");
  await symlink(secret, join(ui.dir, "linked.txt"));
  const paths = ["/..%2fsecret.txt", "/icons/..%2f..%2fsecret.txt", "/%2e%2e/secret.txt", "/../secret.txt", "/linked.txt", "/icons", "/nope.js"];
  for (const path of paths) {
    const res = await serverRequest(server.port, { path });
    expect(res.status, path).toBe(404);
    expect(res.body, path).not.toContain("secret");
  }
});

test("close removes server.json and lets the next server start", async () => {
  const server = await start();
  await server.close();
  expect(existsSync(serverFile())).toBe(false);
  await expect(fetch(`${server.url}api/health`)).rejects.toThrow();
  const next = await start();
  expect(JSON.parse(await readFile(serverFile(), "utf8"))).toMatchObject({ port: next.port });
});
