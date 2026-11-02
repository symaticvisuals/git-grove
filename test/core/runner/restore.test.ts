import { realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { listPins } from "../../../src/core/runner/list-pins.js";
import { pin } from "../../../src/core/runner/pin.js";
import { RefusedError } from "../../../src/core/runner/refused.error.js";
import { restoreHeld, type RestoreResult } from "../../../src/core/runner/restore-held.js";
import { withRepoLock } from "../../../src/core/runner/with-repo-lock.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
let original: string;
let squashed: string;

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat/x");
  await repo.switch("feat/x");
  await repo.commit("a.txt", "a\n", "a");
  await repo.commit("b.txt", "b\n", "b");
  original = await repo.commit("c.txt", "c\n", "c");
  await pin(repo.path, "feat/x", original, new Date(Date.UTC(2026, 10, 1, 1, 0, 0)));
  await repo.git("reset", "--soft", "main");
  await repo.git("commit", "-m", "squashed");
  squashed = (await repo.git("rev-parse", "HEAD")).trim();
});
afterEach(() => repo.cleanup());

/** Takes the repo lock and runs restoreHeld on facts read under it, as the restore action's run does. */
async function restore(cwd: string, branch: string, pinRef?: string, beforeMove?: () => Promise<void>): Promise<RestoreResult> {
  const { commonDir } = await readRepoFacts(cwd);
  return withRepoLock(commonDir, async () => restoreHeld(await readRepoFacts(cwd), branch, pinRef, beforeMove));
}

test("restore brings back the commits and pins the squashed tip", async () => {
  expect((await repo.git("rev-list", "--count", "main..feat/x")).trim()).toBe("1");
  const result = await restore(repo.path, "feat/x");
  expect(result).toMatchObject({ from: squashed, to: original });
  expect((await repo.git("rev-list", "--count", "main..feat/x")).trim()).toBe("3");
  if (result.kind !== "moved") throw new Error("expected the existing branch to move");
  expect((await repo.git("rev-parse", result.pinnedCurrent)).trim()).toBe(squashed);
  expect((await listPins(repo.path, "feat/x")).length).toBe(2);
});

test("restore recreates a deleted branch at its newest pin and pins nothing", async () => {
  await repo.switch("main");
  await repo.git("branch", "-D", "feat/x");
  const result = await restore(repo.path, "feat/x");
  expect(result).toMatchObject({ kind: "created", to: original });
  expect((await repo.git("rev-parse", "feat/x")).trim()).toBe(original);
  expect((await listPins(repo.path, "feat/x")).length).toBe(1);
});

test("restore refuses to recreate a branch a worktree still has checked out", async () => {
  await repo.switch("main");
  await repo.worktree(join(repo.path, ".worktrees", "held"), "held");
  await pin(repo.path, "held", original, new Date(Date.UTC(2026, 10, 1, 2, 0, 0)));
  await repo.git("update-ref", "-d", "refs/heads/held");
  await expect(restore(repo.path, "held")).rejects.toThrow("checked out but the branch is gone");
  expect(await repo.git("show-ref", "--verify", "--quiet", "refs/heads/held").catch(() => "missing")).toBe("missing");
});

test("restore moves a branch that is not checked out anywhere", async () => {
  await repo.switch("main");
  const result = await restore(repo.path, "feat/x");
  expect(result.to).toBe(original);
  expect((await repo.git("rev-parse", "feat/x")).trim()).toBe(original);
});

test("restore refuses when the worktree has an uncommitted file", async () => {
  await writeFile(join(repo.path, "base.txt"), "dirty\n");
  await expect(restore(repo.path, "feat/x")).rejects.toBeInstanceOf(RefusedError);
  expect((await repo.git("rev-parse", "feat/x")).trim()).toBe(squashed);
});

test("restore refuses when the branch has no pin", async () => {
  await expect(restore(repo.path, "main")).rejects.toBeInstanceOf(RefusedError);
});

test("restore refuses on an untracked file and creates no pin", async () => {
  await writeFile(join(repo.path, "stray.txt"), "x\n");
  await expect(restore(repo.path, "feat/x")).rejects.toBeInstanceOf(RefusedError);
  expect((await listPins(repo.path, "feat/x")).length).toBe(1);
});

test("restore refuses without resetting when the tip moves before the move", async () => {
  await expect(
    restore(repo.path, "feat/x", undefined, async () => {
      await repo.commit("late.txt", "late\n", "late");
    }),
  ).rejects.toThrow("moved while restoring");
  expect((await repo.git("rev-parse", "feat/x~1")).trim()).toBe(squashed);
});

async function conflictWithMain(): Promise<void> {
  const side = join(repo.path, ".worktrees", "main-side");
  await repo.git("worktree", "add", side, "main");
  await writeFile(join(side, "base.txt"), "from main\n");
  await repo.git("-C", side, "commit", "-am", "main edits base");
  await writeFile(join(repo.path, "base.txt"), "from feat\n");
  await repo.git("commit", "-am", "feat edits base");
}

test("restore refuses when the worktree holding the branch is mid-merge, and pins nothing", async () => {
  await conflictWithMain();
  await expect(repo.git("merge", "main")).rejects.toThrow();
  await expect(restore(repo.path, "feat/x")).rejects.toThrow(
    `git-grove: feat/x has a merge in progress in ${await realpath(repo.path)}; finish or abort it first`,
  );
  expect((await listPins(repo.path, "feat/x")).length).toBe(1);
});

test("restore refuses when a worktree is mid-rebase of the branch on a detached HEAD", async () => {
  await conflictWithMain();
  const tip = (await repo.git("rev-parse", "feat/x")).trim();
  await expect(repo.git("rebase", "main")).rejects.toThrow();
  await expect(restore(repo.path, "feat/x")).rejects.toThrow("feat/x has a rebase in progress in");
  expect((await repo.git("rev-parse", "feat/x")).trim()).toBe(tip);
  expect((await listPins(repo.path, "feat/x")).length).toBe(1);
});

test("restore moves a branch whose worktree folder is gone without touching that folder", async () => {
  await repo.switch("main");
  const held = join(repo.path, ".worktrees", "held");
  await repo.git("worktree", "add", held, "feat/x");
  await rm(held, { recursive: true, force: true });
  const result = await restore(repo.path, "feat/x");
  expect(result).toMatchObject({ kind: "moved", to: original, commitsBack: 3 });
  expect((await repo.git("rev-parse", "feat/x")).trim()).toBe(original);
});

test("restore refuses on an untracked file even when status.showUntrackedFiles is no", async () => {
  await repo.git("config", "status.showUntrackedFiles", "no");
  await writeFile(join(repo.path, "stray.txt"), "x\n");
  await expect(restore(repo.path, "feat/x")).rejects.toThrow("has uncommitted changes");
  expect((await repo.git("rev-parse", "feat/x")).trim()).toBe(squashed);
});
