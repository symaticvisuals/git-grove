import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { PortsInUseError } from "../../src/server/http/ports-in-use.error.js";
import { ServerRunningError } from "../../src/server/server-running.error.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { writeServerFile } from "../../src/server/write-server-file.js";
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

function occupy(port: number): Promise<Server | null> {
  const blocker = createServer();
  return new Promise((resolve) => {
    blocker.once("error", () => resolve(null));
    blocker.listen(port, "127.0.0.1", () => {
      blockers.push(blocker);
      resolve(blocker);
    });
  });
}

async function occupyFreePort(): Promise<number> {
  const blocker = await occupy(0);
  const address = blocker?.address();
  if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function closedPort(): Promise<number> {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const address = blocker.address();
  await new Promise((resolve) => blocker.close(resolve));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

/** A stand-in that answers `/api/health` as process `pid`, as a grove server would, after running `onProbe`. */
async function fakeHealth(pid: number, onProbe: () => void = () => undefined): Promise<number> {
  const fake = createHttpServer((_req, res) => {
    onProbe();
    res.end(JSON.stringify({ ok: true, version: "0.0.1", pid }));
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  blockers.push(fake);
  const address = fake.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

function lockFile(): string {
  return join(home, "server.lock");
}

function cookieOf(server: RunningServer): string {
  return `grove_token=${server.token}`;
}

function post(server: RunningServer, path: string, headers: Record<string, string> = {}, body = "{}"): Promise<Response> {
  return fetch(`${server.url}${path.slice(1)}`, {
    method: "POST",
    headers: { cookie: cookieOf(server), "x-grove-token": server.token, "content-type": "application/json", ...headers },
    body,
  });
}

function serverFile(): string {
  return join(home, "server.json");
}

function readServerFilePort(): unknown {
  const parsed: unknown = JSON.parse(readFileSync(serverFile(), "utf8"));
  return typeof parsed === "object" && parsed !== null && "port" in parsed ? parsed.port : null;
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

test("a second server with the same home refuses while the first runs", async () => {
  const first = await start();
  const second = start();
  await expect(second).rejects.toBeInstanceOf(ServerRunningError);
  await expect(second).rejects.toMatchObject({ port: first.port, pid: process.pid, url: first.url });
  expect(JSON.parse(await readFile(serverFile(), "utf8"))).toMatchObject({ port: first.port });
});

test("a lock held by a live process whose server.json port answers as another process is taken over", async () => {
  await writeFile(lockFile(), String(process.pid));
  writeServerFile(home, { pid: process.pid, port: await fakeHealth(process.pid + 1), version: "0.0.1" });
  const before = (await stat(lockFile())).ino;
  const server = await start();
  expect((await stat(lockFile())).ino).not.toBe(before);
  expect(JSON.parse(await readFile(serverFile(), "utf8"))).toEqual({ pid: process.pid, port: server.port, version: VERSION });
});

test("a lock held by a live process with no server.json is taken over once a starting server would have written it", async () => {
  await writeFile(lockFile(), String(process.pid));
  const before = (await stat(lockFile())).ino;
  const startedAt = Date.now();
  const server = await start();
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
  expect((await stat(lockFile())).ino).not.toBe(before);
  expect(readServerFilePort()).toBe(server.port);
});

test("a lock that changes hands while it is checked is put back, not taken over", async () => {
  await writeFile(lockFile(), String(process.pid));
  const handOver = (): void => writeFileSync(lockFile(), String(process.ppid));
  writeServerFile(home, { pid: process.pid, port: await fakeHealth(process.pid + 1, handOver), version: "0.0.1" });
  const second = start();
  await expect(second).rejects.toBeInstanceOf(ServerRunningError);
  await expect(second).rejects.toMatchObject({ pid: process.ppid });
  expect(await readFile(lockFile(), "utf8")).toBe(String(process.ppid));
  expect(await readdir(home)).not.toContainEqual(expect.stringMatching(/^server\.lock\./));
});

test("a server still starting is waited for, and then refused", async () => {
  await writeFile(lockFile(), String(process.pid));
  writeServerFile(home, { pid: process.pid + 1, port: await closedPort(), version: "0.0.0" });
  const before = (await stat(lockFile())).ino;
  const port = await fakeHealth(process.pid);
  setTimeout(() => writeServerFile(home, { pid: process.pid, port, version: "0.0.1" }), 200);
  const second = start();
  await expect(second).rejects.toBeInstanceOf(ServerRunningError);
  await expect(second).rejects.toMatchObject({ port, pid: process.pid });
  expect((await stat(lockFile())).ino).toBe(before);
});

test("takes the next port when the asked one is busy", async () => {
  const busy = await occupyFreePort();
  const server = await start({ port: busy });
  expect(server.port).toBe(busy + 1);
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

test("GET /?token= sets an HttpOnly SameSite=Strict cookie and redirects without the token", async () => {
  const server = await start();
  const res = await fetch(`${server.url}?token=${server.token}`, { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`grove_token=${server.token}`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Max-Age=31536000");
});

test("/ with the cookie serves index.html with the token in a meta tag, a CSP and no-store", async () => {
  const server = await start();
  const res = await fetch(server.url, { headers: { cookie: cookieOf(server) } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  const body = await res.text();
  expect(body).toContain(`<meta name="grove-token" content="${server.token}">`);
  expect(body).toContain(`<meta name="grove-version" content="${VERSION}">`);
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("default-src 'self'");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("/ without the cookie is 401 and does not hold the token", async () => {
  const server = await start();
  const res = await fetch(server.url);
  expect(res.status).toBe(401);
  expect(await res.text()).not.toContain(server.token);
});

test("every response carries the security headers", async () => {
  const server = await start();
  const replies = [
    await fetch(server.url, { headers: { cookie: cookieOf(server) } }),
    await fetch(`${server.url}api/health`),
    await fetch(`${server.url}api/nope`),
    await fetch(`${server.url}sw.js`),
    await fetch(`${server.url}?token=${server.token}`, { redirect: "manual" }),
  ];
  for (const res of replies) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name), `${res.url} ${name}`).toBe(value);
  }
  const rebound = await serverRequest(server.port, { headers: { host: `evil.test:${server.port}` } });
  expect(rebound.headers).toMatchObject(SECURITY_HEADERS);
});

test("the public assets load without the cookie", async () => {
  const server = await start();
  const cases: [string, string][] = [
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
  expect((await fetch(`${server.url}app.js`)).status).toBe(401);
  expect((await fetch(`${server.url}app.js`, { headers: { cookie: cookieOf(server) } })).status).toBe(200);
});

test("a rebound Host is 421 even with the cookie", async () => {
  const server = await start();
  const rebound = await serverRequest(server.port, { headers: { host: `evil.test:${server.port}`, cookie: cookieOf(server) } });
  expect(rebound.status).toBe(421);
  expect(rebound.body).not.toContain(server.token);
  const localhost = await serverRequest(server.port, { headers: { host: `localhost:${server.port}`, cookie: cookieOf(server) } });
  expect(localhost.status).toBe(200);
  expect(localhost.body).toContain(server.token);
});

test("POST /api/shutdown needs the header, then closes the server and calls onShutdown(75)", async () => {
  let resolveCode: (code: number) => void = () => undefined;
  const stopped = new Promise<number>((resolve) => (resolveCode = resolve));
  const server = await start({ onShutdown: (code) => resolveCode(code) });

  const refused = await fetch(`${server.url}api/shutdown`, {
    method: "POST",
    headers: { cookie: cookieOf(server), "content-type": "application/json" },
    body: "{}",
  });
  expect(refused.status).toBe(403);
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
  const res = await fetch(`${server.url}api/shutdown`, { headers: { cookie: cookieOf(server) } });
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
    headers: { cookie: cookieOf(server), "x-grove-token": server.token, "content-type": "application/json", "transfer-encoding": "chunked" },
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
      `Cookie: ${cookieOf(server)}`,
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
    await fetch(server.url, { headers: { ...evil, cookie: cookieOf(server) } }),
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
  const cookie = cookieOf(server);
  for (const path of ["/..%2fsecret.txt", "/icons/..%2f..%2fsecret.txt", "/%2e%2e/secret.txt", "/../secret.txt", "/linked.txt", "/icons", "/nope.js"]) {
    const res = await serverRequest(server.port, { path, headers: { cookie } });
    expect(res.status, path).toBe(404);
    expect(res.body, path).not.toContain("secret");
  }
});

test("a climbing path behind a cookie-free folder neither skips the cookie nor reaches index.html", async () => {
  const server = await start();
  const anonymous = await serverRequest(server.port, { path: "/icons/..%2findex.html" });
  expect(anonymous.status).toBe(401);
  expect(anonymous.body).not.toContain(server.token);
  const signedIn = await serverRequest(server.port, { path: "/icons/..%2findex.html", headers: { cookie: cookieOf(server) } });
  expect(signedIn.status).toBe(404);
});

test("close removes server.json and lets the next server start", async () => {
  const server = await start();
  await server.close();
  expect(existsSync(serverFile())).toBe(false);
  await expect(fetch(`${server.url}api/health`)).rejects.toThrow();
  const next = await start();
  expect(JSON.parse(await readFile(serverFile(), "utf8"))).toMatchObject({ port: next.port });
});
