import { writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { lockServer } from "../../src/server/lock-server.js";
import { ServerRunningError } from "../../src/server/server-running.error.js";
import { ServerUnresponsiveError } from "../../src/server/server-unresponsive.error.js";
import { writeServerFile } from "../../src/server/write-server-file.js";

let home: string;
let listeners: Server[];
let sockets: Socket[];
let releases: (() => Promise<void>)[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-lock-"));
  listeners = [];
  sockets = [];
  releases = [];
});
afterEach(async () => {
  await Promise.all(releases.map((release) => release()));
  for (const socket of sockets) socket.destroy();
  await Promise.all(listeners.map((listener) => new Promise((resolve) => listener.close(resolve))));
  await rm(home, { recursive: true, force: true });
});

function lockFile(): string {
  return join(home, "server.lock");
}

async function lock(): Promise<void> {
  releases.push(await lockServer(home));
}

async function inode(): Promise<number> {
  return (await stat(lockFile())).ino;
}

function portOf(listener: Server): number {
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = portOf(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** A stand-in that answers `/api/health` as process `pid`, as a grove server would, after running `onProbe`. */
async function fakeHealth(pid: number, onProbe: () => void = () => undefined): Promise<number> {
  const fake = createHttpServer((_req, res) => {
    onProbe();
    res.end(JSON.stringify({ ok: true, version: "0.0.1", pid }));
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  listeners.push(fake);
  return portOf(fake);
}

/** A listener that accepts connections and never answers, as a stopped or hung server does. */
async function silentPort(): Promise<number> {
  const silent = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  listeners.push(silent);
  return portOf(silent);
}

test("a free lock is taken", async () => {
  await lock();
  expect(await readFile(lockFile(), "utf8")).toBe(String(process.pid));
});

test("a lock held by a live process whose port refuses is taken over", async () => {
  await writeFile(lockFile(), String(process.pid));
  writeServerFile(home, { pid: process.pid, port: await closedPort(), version: "0.0.1" });
  const before = await inode();
  await lock();
  expect(await inode()).not.toBe(before);
});

test("a lock held by a live process whose port answers as another process is taken over", async () => {
  await writeFile(lockFile(), String(process.pid));
  writeServerFile(home, { pid: process.pid, port: await fakeHealth(process.pid + 1), version: "0.0.1" });
  const before = await inode();
  await lock();
  expect(await inode()).not.toBe(before);
});

test("a lock whose server answers as its holder stands", async () => {
  await writeFile(lockFile(), String(process.pid));
  const port = await fakeHealth(process.pid);
  writeServerFile(home, { pid: process.pid, port, version: "0.0.1" });
  const before = await inode();
  await expect(lockServer(home)).rejects.toMatchObject({ name: "ServerRunningError", port, pid: process.pid });
  expect(await inode()).toBe(before);
});

test("a holder whose server does not answer within 1 s keeps its lock, and the caller is told to retry", async () => {
  await writeFile(lockFile(), String(process.pid));
  writeServerFile(home, { pid: process.pid, port: await silentPort(), version: "0.0.1" });
  const before = await inode();
  await expect(lockServer(home)).rejects.toBeInstanceOf(ServerUnresponsiveError);
  expect(await inode()).toBe(before);
});

test("a fresh lock held by a live process that writes no server.json is not taken over", async () => {
  await writeFile(lockFile(), String(process.pid));
  const before = await inode();
  const startedAt = Date.now();
  await expect(lockServer(home)).rejects.toBeInstanceOf(ServerUnresponsiveError);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
  expect(await inode()).toBe(before);
});

test("a lock written before the last boot is taken over without waiting or probing", async () => {
  await writeFile(lockFile(), String(process.pid));
  const beforeBoot = (Date.now() - uptime() * 1000 - 60_000) / 1000;
  await utimes(lockFile(), beforeBoot, beforeBoot);
  const before = await inode();
  const startedAt = Date.now();
  await lock();
  expect(Date.now() - startedAt).toBeLessThan(1000);
  expect(await inode()).not.toBe(before);
});

test("a server still starting is waited for, and then refused", async () => {
  await writeFile(lockFile(), String(process.pid));
  writeServerFile(home, { pid: process.pid + 1, port: await closedPort(), version: "0.0.0" });
  const before = await inode();
  const port = await fakeHealth(process.pid);
  setTimeout(() => writeServerFile(home, { pid: process.pid, port, version: "0.0.1" }), 200);
  await expect(lockServer(home)).rejects.toMatchObject({ name: "ServerRunningError", port, pid: process.pid });
  expect(await inode()).toBe(before);
});

test("a lock that changes hands while it is checked is put back, not taken over", async () => {
  await writeFile(lockFile(), String(process.pid));
  const handOver = (): void => writeFileSync(lockFile(), String(process.ppid));
  writeServerFile(home, { pid: process.pid, port: await fakeHealth(process.pid + 1, handOver), version: "0.0.1" });
  const refused = lockServer(home);
  await expect(refused).rejects.toBeInstanceOf(ServerRunningError);
  await expect(refused).rejects.toMatchObject({ pid: process.ppid });
  expect(await readFile(lockFile(), "utf8")).toBe(String(process.ppid));
  expect(await readdir(home)).not.toContainEqual(expect.stringMatching(/^server\.lock\./));
});

test("an empty lock that gains a pid during the grace is judged by that pid", async () => {
  await writeFile(lockFile(), "");
  const port = await fakeHealth(process.pid);
  setTimeout(() => {
    writeFileSync(lockFile(), String(process.pid));
    writeServerFile(home, { pid: process.pid, port, version: "0.0.1" });
  }, 200);
  await expect(lockServer(home)).rejects.toMatchObject({ name: "ServerRunningError", port, pid: process.pid });
  expect(await readFile(lockFile(), "utf8")).toBe(String(process.pid));
});

test.each([
  ["empty", ""],
  ["garbage", "not a pid\n"],
])("a lock still %s after the grace is taken over", async (_name, text) => {
  await writeFile(lockFile(), text);
  const before = await inode();
  const startedAt = Date.now();
  await lock();
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
  expect(await inode()).not.toBe(before);
  expect(await readFile(lockFile(), "utf8")).toBe(String(process.pid));
});
