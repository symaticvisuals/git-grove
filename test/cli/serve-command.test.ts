import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { serveCommand } from "../../src/cli/commands/serve.js";
import { run } from "../../src/cli/main.js";
import { readServerFile } from "../../src/server/read-server-file.js";
import { serverAlive } from "../../src/server/server-alive.js";
import type { ServerInfo } from "../../src/server/server-info.types.js";
import { startServer } from "../../src/server/start-server.js";
import { writeServerFile } from "../../src/server/write-server-file.js";

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-serve-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

async function waitForServer(): Promise<ServerInfo> {
  for (let tries = 0; tries < 200; tries++) {
    const info = readServerFile(home);
    if (info !== null) return info;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("server.json never appeared");
}

function io(): { out: string[]; err: string[]; io: { out: (s: string) => void; err: (s: string) => void; cwd: string } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s), cwd: home } };
}

test("serveCommand --port 0 exits 75 after /api/shutdown", async () => {
  const cli = io();
  const exited = run(["serve", "--port", "0"], cli.io);
  const info = await waitForServer();
  const token = await readFile(join(home, "token"), "utf8");
  const res = await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, {
    method: "POST",
    headers: { "x-grove-token": token, "content-type": "application/json" },
  });
  expect(res.status).toBe(202);
  expect(await exited).toBe(75);
  expect(cli.out.join("")).toContain(`http://127.0.0.1:${info.port}/`);
  expect(cli.out.join("")).not.toContain(token);
  expect(existsSync(join(home, "server.json"))).toBe(false);
});

test("serve keeps one old log: a server.log over 5 MB moves to server.log.1 when it starts", async () => {
  const big = 5 * 1024 * 1024 + 1;
  await writeFile(join(home, "server.log"), Buffer.alloc(big, 120));
  const cli = io();
  const exited = run(["serve", "--port", "0"], cli.io);
  const info = await waitForServer();
  await vi.waitFor(async () => expect((await stat(join(home, "server.log.1"))).size).toBe(big));
  expect((await stat(join(home, "server.log"))).size).toBe(0);
  const token = await readFile(join(home, "token"), "utf8");
  await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: "POST", headers: { "x-grove-token": token, "content-type": "application/json" } });
  expect(await exited).toBe(75);
});

test("serve leaves a server.log of 5 MB or less alone", async () => {
  await writeFile(join(home, "server.log"), "started\n");
  const cli = io();
  const exited = run(["serve", "--port", "0"], cli.io);
  const info = await waitForServer();
  expect(await readFile(join(home, "server.log"), "utf8")).toBe("started\n");
  expect(existsSync(join(home, "server.log.1"))).toBe(false);
  const token = await readFile(join(home, "token"), "utf8");
  await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: "POST", headers: { "x-grove-token": token, "content-type": "application/json" } });
  expect(await exited).toBe(75);
});

async function closedPort(): Promise<number> {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const address = blocker.address();
  await new Promise((resolve) => blocker.close(resolve));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function waitForLiveServer(): Promise<ServerInfo> {
  for (let tries = 0; tries < 200; tries++) {
    const info = readServerFile(home);
    if (info !== null && (await serverAlive(info))) return info;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no server answered");
}

test("serve starts over a lock left by a live process that is not a server, and replaces the lock", async () => {
  const lock = join(home, "server.lock");
  await writeFile(lock, String(process.pid));
  writeServerFile(home, { pid: process.pid, port: await closedPort(), version: "0.0.1" });
  const before = (await stat(lock)).ino;
  const cli = io();
  const exited = run(["serve", "--port", "0"], cli.io);
  const info = await waitForLiveServer();
  expect((await stat(lock)).ino).not.toBe(before);
  expect(await readFile(lock, "utf8")).toBe(String(process.pid));
  const token = await readFile(join(home, "token"), "utf8");
  const res = await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, {
    method: "POST",
    headers: { "x-grove-token": token, "content-type": "application/json" },
  });
  expect(res.status).toBe(202);
  expect(await exited).toBe(75);
  expect(cli.out.join("")).not.toContain("already running");
  expect(existsSync(lock)).toBe(false);
});

const STAND_IN_SERVER = `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const home = process.argv[1];
writeFileSync(join(home, "server.lock"), String(process.pid));
const server = require("node:http").createServer((_req, res) => res.end(JSON.stringify({ ok: true, version: "0.0.1", pid: process.pid })));
server.listen(0, "127.0.0.1", () => {
  writeFileSync(join(home, "server.json"), JSON.stringify({ pid: process.pid, port: server.address().port, version: "0.0.1" }));
  process.stdout.write("ready\\n");
});
`;

test("serve B leaves the lock alone while server A is stopped, and exits non-zero so the service retries", async () => {
  const serverA = spawn(process.execPath, ["-e", STAND_IN_SERVER, home], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise<void>((resolve, reject) => {
      serverA.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("ready")) resolve();
      });
      serverA.once("exit", () => reject(new Error("server A exited")));
    });
    const info = readServerFile(home);
    expect(info).not.toBeNull();
    if (info === null) return;
    expect(await serverAlive(info)).toBe(true);
    process.kill(info.pid, "SIGSTOP");
    const cli = io();
    expect(await run(["serve", "--port", "0"], cli.io)).toBe(1);
    expect(cli.err.join("")).toBe(
      `git-grove: process ${info.pid} holds the server lock, but its server on port ${info.port} does not answer; ` +
        `if no git grove server is running, delete ${join(home, "server.lock")} and start again\n`,
    );
    expect(await readFile(join(home, "server.lock"), "utf8")).toBe(String(info.pid));
    expect(readServerFile(home)).toEqual(info);
  } finally {
    serverA.kill("SIGKILL");
  }
});

test.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)("serve stops cleanly and exits 0 on %s", async (signal) => {
  const others = process.listeners(signal);
  process.removeAllListeners(signal);
  try {
    const cli = io();
    const exited = serveCommand(cli.io, { port: 0 });
    await waitForLiveServer();
    process.emit(signal, signal);
    expect(await exited).toBe(0);
    expect(existsSync(join(home, "server.json"))).toBe(false);
    expect(existsSync(join(home, "server.lock"))).toBe(false);
    expect(process.listenerCount(signal)).toBe(0);
  } finally {
    for (const listener of others) process.on(signal, listener);
  }
});

test("serve says where the running server is and exits 0", async () => {
  const running = await startServer({ port: 0, home, version: "1" });
  try {
    const cli = io();
    expect(await serveCommand(cli.io, { port: 0 })).toBe(0);
    expect(cli.out.join("")).toBe(`already running at http://127.0.0.1:${running.port}/\n`);
  } finally {
    await running.close();
  }
});

test.each([["abc"], ["-1"], ["65536"], ["1.5"]])("serve --port %s is refused", async (port) => {
  const cli = io();
  expect(await run(["serve", "--port", port], cli.io)).toBe(1);
  expect(cli.err.join("")).toContain("--port");
  expect(existsSync(join(home, "server.json"))).toBe(false);
});

test("--port belongs to serve alone", async () => {
  const cli = io();
  expect(await run(["status", "--port", "1"], cli.io)).toBe(1);
  expect(cli.err.join("")).toContain("Usage: git grove");
});
