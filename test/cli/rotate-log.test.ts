import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { rotateLog } from "../../src/cli/rotate-log.js";

let dir: string;
let log: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-grove-log-"));
  log = join(dir, "server.log");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a log over the limit moves to .1 and starts empty, replacing the older .1", async () => {
  await writeFile(`${log}.1`, "oldest");
  await writeFile(log, "x".repeat(101));
  expect(await rotateLog(log, 100)).toBe(true);
  expect(await readFile(`${log}.1`, "utf8")).toBe("x".repeat(101));
  expect((await stat(log)).size).toBe(0);
  expect(existsSync(`${log}.2`)).toBe(false);
});

test("a log at or under the limit, or none at all, is left alone", async () => {
  await writeFile(log, "x".repeat(100));
  expect(await rotateLog(log, 100)).toBe(false);
  expect((await stat(log)).size).toBe(100);
  expect(existsSync(`${log}.1`)).toBe(false);
  await rm(log);
  expect(await rotateLog(log, 100)).toBe(false);
  expect(existsSync(log)).toBe(false);
});

test("a descriptor opened for appending keeps writing to server.log after the rotation", async () => {
  await writeFile(log, "x".repeat(101));
  const handle = await open(log, "a");
  try {
    await rotateLog(log, 100);
    await handle.write("after\n");
  } finally {
    await handle.close();
  }
  expect(await readFile(log, "utf8")).toBe("after\n");
});
