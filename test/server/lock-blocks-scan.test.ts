import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { lockBlocksScan } from "../../src/server/live/lock-blocks-scan.js";

const BEFORE_BOOT = new Date("2025-01-01T00:00:00Z");

let folder: string;
let lock: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "git-grove-scan-lock-"));
  lock = join(folder, "grove.lock");
});
afterEach(() => rm(folder, { recursive: true, force: true }));

test("a fresh lock naming a live process blocks, including pid 1 answering EPERM", async () => {
  await writeFile(lock, `${process.pid}\n`);
  expect(await lockBlocksScan(lock)).toBe(true);
  await writeFile(lock, "1\n");
  expect(await lockBlocksScan(lock)).toBe(true);
});

test("a lock written before the last boot does not block, whatever pid it names", async () => {
  await writeFile(lock, "1\n");
  await utimes(lock, BEFORE_BOOT, BEFORE_BOOT);
  expect(await lockBlocksScan(lock)).toBe(false);
});

test("a lock older than 15 minutes does not block", async () => {
  await writeFile(lock, `${process.pid}\n`);
  const old = new Date(Date.now() - 16 * 60_000);
  await utimes(lock, old, old);
  expect(await lockBlocksScan(lock)).toBe(false);
});

test("a missing lock, or one naming a dead pid, does not block", async () => {
  expect(await lockBlocksScan(lock)).toBe(false);
  await writeFile(lock, "2147483646\n");
  expect(await lockBlocksScan(lock)).toBe(false);
});
