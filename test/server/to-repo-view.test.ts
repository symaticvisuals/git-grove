import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openStore } from "../../src/core/journal/open-store.js";
import type { Store } from "../../src/core/journal/store.types.js";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { toProject } from "../../src/server/wire/to-project.js";
import { toRepoView } from "../../src/server/wire/to-repo-view.js";
import type { WireRepoView } from "../../src/server/wire/wire.types.js";
import { cleanupLabel } from "../../ui/src/cleanup-label.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let dir: string;
let store: Store;
let repo: TestRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-grove-repo-view-"));
  store = openStore(join(dir, "grove.db"));
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  await repo.commit("base.txt", "base\n", "base");
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
  await repo.cleanup();
});

async function view(): Promise<WireRepoView> {
  const snapshot = await readSnapshot(repo.path, store, Date.now());
  const stored = store.repos()[0];
  if (stored === undefined) throw new Error("no repo");
  return toRepoView(toProject(stored, snapshot, 0, null), snapshot, 0);
}

async function sandbox(name: string): Promise<string> {
  const path = join(repo.path, ".worktrees", name);
  await repo.git("worktree", "add", "--detach", path, "main");
  return path;
}

test("a merged worktree with a precious ignored file counts as needing a rescue, never as safe", async () => {
  const old = join(repo.path, ".worktrees", "old");
  await repo.worktree(old, "old");
  await writeFile(join(old, "old.txt"), "old\n");
  await repo.git("-C", old, "add", "old.txt");
  await repo.git("-C", old, "commit", "-m", "add old");
  await repo.git("merge", "--ff-only", "old");
  await mkdir(join(old, ".local"));
  await writeFile(join(old, ".local", "seed.sql"), "insert;\n");

  const shown = await view();
  expect(shown).toMatchObject({ cleanupCount: 0, rescueCount: 1 });
  expect(cleanupLabel(shown)).toBe("1 worktree to clean up, needs a rescue");
});

test("only a clean sandbox with nothing of its own counts as safe to clean up", async () => {
  await sandbox("clean");
  const dirty = await sandbox("dirty");
  await writeFile(join(dirty, "base.txt"), "edited\n");
  const own = await sandbox("own");
  await writeFile(join(own, "exp.txt"), "experiment\n");
  await repo.git("-C", own, "add", "exp.txt");
  await repo.git("-C", own, "commit", "-m", "experiment");

  const shown = await view();
  expect(shown.detached).toHaveLength(3);
  expect(shown).toMatchObject({ cleanupCount: 1, rescueCount: 0 });
  expect(cleanupLabel(shown)).toBe("1 worktree safe to clean up");
});
