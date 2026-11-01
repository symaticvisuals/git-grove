import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { takeOverServerLock } from "../../src/server/take-over-server-lock.js";

let home: string;
let lock: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-take-over-"));
  lock = join(home, "server.lock");
});
afterEach(() => rm(home, { recursive: true, force: true }));

test.each([
  ["an empty lock", "", null],
  ["a garbage lock", "nonsense\n", null],
  ["a lock naming the stale pid", "4242", 4242],
])("%s that is still as expected is replaced", async (_name, text, stale) => {
  await writeFile(lock, text);
  const release = await takeOverServerLock(lock, stale);
  expect(release).not.toBeNull();
  expect(await readFile(lock, "utf8")).toBe(String(process.pid));
  await release?.();
  expect(await readdir(home)).toEqual([]);
});

test.each([
  ["an empty lock that gained a pid", "4242", null],
  ["a pid lock that went empty", "", 4242],
  ["a pid lock that names someone else", "777", 4242],
])("%s is put back untouched", async (_name, text, stale) => {
  await writeFile(lock, text);
  expect(await takeOverServerLock(lock, stale)).toBeNull();
  expect(await readFile(lock, "utf8")).toBe(text);
  expect(await readdir(home)).toEqual(["server.lock"]);
});

test("a lock gone before it could be moved is simply taken", async () => {
  const release = await takeOverServerLock(lock, 4242);
  expect(await readFile(lock, "utf8")).toBe(String(process.pid));
  await release?.();
});
