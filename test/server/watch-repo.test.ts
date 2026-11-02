import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { watchRepo } from "../../src/server/live/watch-repo.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: TestRepo;
let gitDir: string;
const open: { close(): void }[] = [];

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit("a.txt", "a\n", "first");
  gitDir = join(repo.path, ".git");
});
afterEach(async () => {
  for (const watcher of open.splice(0)) watcher.close();
  await repo.cleanup();
});

function watch(onChange: () => void, options: { debounceMs?: number; maxWaitMs?: number; pollMs?: number }): void {
  open.push(watchRepo(gitDir, onChange, options));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("a commit in a linked worktree fires one change after the debounce", async () => {
  const tree = join(repo.path, ".worktrees", "linked");
  await repo.worktree(tree, "feat/linked");
  await sleep(200);
  let count = 0;
  watch(() => void (count += 1), { debounceMs: 50, pollMs: 60_000 });
  await sleep(100);
  await writeFile(join(tree, "b.txt"), "b\n");
  await repo.git("-C", tree, "add", "b.txt");
  await repo.git("-C", tree, "commit", "-m", "second");
  await vi.waitFor(() => expect(count).toBe(1));
  await sleep(300);
  expect(count).toBe(1);
});

test("a file written under objects/ fires nothing within 400 ms", async () => {
  let count = 0;
  watch(() => void (count += 1), { debounceMs: 50, pollMs: 60_000 });
  await sleep(100);
  await mkdir(join(gitDir, "objects", "zz"), { recursive: true });
  await writeFile(join(gitDir, "objects", "zz", "loose"), "x");
  await sleep(400);
  expect(count).toBe(0);
});

test("a continuous burst still fires every maxWaitMs", async () => {
  let count = 0;
  watch(() => void (count += 1), { debounceMs: 200, maxWaitMs: 150, pollMs: 60_000 });
  await sleep(100);
  for (let i = 0; i < 25; i += 1) {
    await writeFile(join(gitDir, "refs", "heads", "burst"), `${i}\n`);
    await sleep(30);
  }
  expect(count).toBeGreaterThanOrEqual(2);
});

test("the poll fires with no fs events", async () => {
  const quiet = await mkdtemp(join(tmpdir(), "git-grove-quiet-"));
  let count = 0;
  open.push(watchRepo(quiet, () => void (count += 1), { debounceMs: 50, pollMs: 50 }));
  await vi.waitFor(() => expect(count).toBeGreaterThanOrEqual(2));
  await rm(quiet, { recursive: true, force: true });
});

test("the poll carries on when the folder cannot be watched", async () => {
  let count = 0;
  open.push(watchRepo(join(repo.path, "missing"), () => void (count += 1), { pollMs: 50 }));
  await vi.waitFor(() => expect(count).toBeGreaterThanOrEqual(1));
});

test("close stops both", async () => {
  let count = 0;
  const watcher = watchRepo(gitDir, () => void (count += 1), { debounceMs: 20, pollMs: 40 });
  await vi.waitFor(() => expect(count).toBeGreaterThanOrEqual(1));
  watcher.close();
  const seen = count;
  await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await sleep(200);
  expect(count).toBe(seen);
});
