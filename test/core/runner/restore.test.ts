import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { listPins } from "../../../src/core/runner/list-pins.js";
import { pin } from "../../../src/core/runner/pin.js";
import { RefusedError } from "../../../src/core/runner/refused.error.js";
import { restore } from "../../../src/core/runner/restore.js";
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

test("restore brings back the commits and pins the squashed tip", async () => {
  expect((await repo.git("rev-list", "--count", "main..feat/x")).trim()).toBe("1");
  const result = await restore(repo.path, "feat/x");
  expect(result).toMatchObject({ from: squashed, to: original });
  expect((await repo.git("rev-list", "--count", "main..feat/x")).trim()).toBe("3");
  expect((await repo.git("rev-parse", result.pinnedCurrent)).trim()).toBe(squashed);
  expect((await listPins(repo.path, "feat/x")).length).toBe(2);
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
