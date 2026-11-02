import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { LockHeldError } from "../../../src/core/runner/lock-held.error.js";
import { acquirePidLock } from "../../../src/core/runner/pid-lock.js";

let folder: string;
let lock: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "git-grove-pid-lock-"));
  lock = join(folder, "grove.lock");
});
afterEach(() => rm(folder, { recursive: true, force: true }));

test("two takeovers racing on one dead-pid lock: exactly one wins and nothing is left aside", async () => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  for (let round = 0; round < 25; round++) {
    await writeFile(lock, String(pid));
    const results = await Promise.allSettled([acquirePidLock(lock), acquirePidLock(lock)]);
    const won = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const lost: unknown[] = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    expect(won).toHaveLength(1);
    expect(lost[0]).toBeInstanceOf(LockHeldError);
    expect(await readFile(lock, "utf8")).toBe(String(process.pid));
    await won[0]?.();
    expect(await readdir(folder)).toEqual([]);
  }
});

test("release leaves a lock that no longer names this process", async () => {
  const release = await acquirePidLock(lock);
  await writeFile(lock, "1");
  await release();
  expect(existsSync(lock)).toBe(true);
  expect(await readFile(lock, "utf8")).toBe("1");
});

test("a lock from before the last boot is held unless staleBeforeBoot is asked for", async () => {
  await writeFile(lock, "1");
  const old = new Date("2025-01-01T00:00:00Z");
  await utimes(lock, old, old);
  await expect(acquirePidLock(lock)).rejects.toBeInstanceOf(LockHeldError);
  const release = await acquirePidLock(lock, { staleBeforeBoot: true });
  expect(await readFile(lock, "utf8")).toBe(String(process.pid));
  await release();
  expect(await readdir(folder)).toEqual([]);
});
