import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearServerFile } from "../../src/server/clear-server-file.js";
import { readServerFile } from "../../src/server/read-server-file.js";
import { serverAlive } from "../../src/server/server-alive.js";
import { startServer } from "../../src/server/start-server.js";
import { writeServerFile } from "../../src/server/write-server-file.js";
import { type UiFixture, uiFixture } from "../support/ui-fixture.js";

let home: string;
let ui: UiFixture;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-server-file-"));
  ui = await uiFixture();
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await ui.cleanup();
});

test("write then read gives the same info, and leaves no temp file behind", async () => {
  writeServerFile(home, { pid: 123, port: 47683, version: "1.2.3" });
  expect(readServerFile(home)).toEqual({ pid: 123, port: 47683, version: "1.2.3" });
  expect(await readdir(home)).toEqual(["server.json"]);
});

test.each([
  ["missing", null],
  ["not JSON", "{"],
  ["the wrong shape", JSON.stringify({ pid: "1", port: 47683, version: "1" })],
  ["a port out of range", JSON.stringify({ pid: 1, port: 70000, version: "1" })],
])("a server.json that is %s reads as null", async (_name, text) => {
  if (text !== null) await writeFile(join(home, "server.json"), text);
  expect(readServerFile(home)).toBeNull();
});

test("clear removes server.json only while it names the pid given", () => {
  writeServerFile(home, { pid: 123, port: 47683, version: "1" });
  clearServerFile(home, 456);
  expect(readServerFile(home)).not.toBeNull();
  clearServerFile(home, 123);
  expect(existsSync(join(home, "server.json"))).toBe(false);
  clearServerFile(home, 123);
});

test("serverAlive is true for a running server and false once it stops", async () => {
  const server = await startServer({ port: 0, home, uiDir: ui.dir, version: "1" });
  const info = readServerFile(home);
  expect(info).not.toBeNull();
  if (info === null) return;
  expect(await serverAlive(info)).toBe(true);
  expect(await serverAlive({ ...info, pid: info.pid + 1 })).toBe(false);
  await server.close();
  expect(await serverAlive(info)).toBe(false);
});

test("serverAlive is false for a pid that no longer runs", async () => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  expect(await serverAlive({ pid, port: 1, version: "1" })).toBe(false);
});
