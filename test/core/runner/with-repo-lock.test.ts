import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { RepoLockedError } from "../../../src/core/runner/repo-locked.error.js";
import { withRepoLock } from "../../../src/core/runner/with-repo-lock.js";

let commonDir: string;
let lock: string;

beforeEach(async () => {
  commonDir = await mkdtemp(join(tmpdir(), "git-grove-lock-"));
  lock = join(commonDir, "grove.lock");
});
afterEach(() => rm(commonDir, { recursive: true, force: true }));

test("a lock whose pid no longer runs is taken over", async () => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  await writeFile(lock, String(pid));
  expect(await withRepoLock(commonDir, () => readFile(lock, "utf8"))).toBe(String(process.pid));
  expect(existsSync(lock)).toBe(false);
});

test("a lock held by a running process is refused", async () => {
  await writeFile(lock, String(process.pid));
  await expect(withRepoLock(commonDir, async () => 1)).rejects.toBeInstanceOf(RepoLockedError);
  expect(await readFile(lock, "utf8")).toBe(String(process.pid));
});

test("an empty lock file counts as held", async () => {
  await writeFile(lock, "");
  await expect(withRepoLock(commonDir, async () => 1)).rejects.toBeInstanceOf(RepoLockedError);
  expect(existsSync(lock)).toBe(true);
});
