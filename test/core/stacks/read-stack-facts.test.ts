import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { isMerged } from "../../../src/core/stacks/is-merged.js";
import { readStackFacts } from "../../../src/core/stacks/read-stack-facts.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat/api");
  await repo.git("config", "branch.feat/api.stackparent", "main");
});

afterEach(async () => {
  await repo.cleanup();
});

async function commitOn(branch: string, file: string, message: string): Promise<void> {
  const dir = join(repo.path, ".worktrees", branch.replace("/", "-"));
  await repo.git("worktree", "add", dir, branch);
  await writeFile(join(dir, file), `${message}\n`);
  await repo.git("-C", dir, "add", file);
  await repo.git("-C", dir, "commit", "-m", message);
  await repo.git("worktree", "remove", dir);
}

test("one new commit on the parent makes the child one parent commit past its fork", async () => {
  await repo.branch("feat/ui", "feat/api");
  await repo.git("config", "branch.feat/ui.stackparent", "feat/api");
  await repo.git("worktree", "add", join(repo.path, ".worktrees", "ui"), "feat/ui");
  await commitOn("feat/api", "api.txt", "api work");

  const features = await readStackFacts(repo.path, await readRepoFacts(repo.path));
  const stack = features.find((f) => f.kind === "stack");
  const ui = stack?.levels.find((l) => l.branch === "feat/ui");
  expect(stack?.levels.map((l) => [l.branch, l.depth])).toEqual([
    ["feat/api", 1],
    ["feat/ui", 2],
  ]);
  expect(ui?.parentCommitsSinceFork).toBe(1);
  expect(ui?.parent).toBe("feat/api");
  expect(ui?.worktree?.branch).toBe("feat/ui");
  expect(ui?.parentMerged).toBe(false);
});

test("a squash merge of the parent into trunk marks it merged and the child's parent merged", async () => {
  await repo.branch("feat/ui", "feat/api");
  await repo.branch("feat/admin", "feat/api");
  await repo.git("config", "branch.feat/ui.stackparent", "feat/api");
  await repo.git("config", "branch.feat/admin.stackparent", "feat/api");
  await commitOn("feat/api", "api.txt", "api work");
  await repo.git("merge", "--squash", "feat/api");
  await repo.git("commit", "-m", "squash api");
  await repo.commit("later.txt", "later\n", "later");

  const facts = await readRepoFacts(repo.path);
  const tip = facts.branches.find((b) => b.name === "feat/api")?.tip ?? "";
  expect(await isMerged(repo.path, tip, facts.trunk.ref)).toBe(true);

  const features = await readStackFacts(repo.path, facts);
  const stack = features.find((f) => f.kind === "stack");
  expect(stack?.levels.find((l) => l.branch === "feat/ui")?.parentMerged).toBe(true);
  expect(stack?.levels.find((l) => l.branch === "feat/api")?.parentMerged).toBe(false);
  expect(stack?.levels.find((l) => l.branch === "feat/ui")?.behindTrunk).toBe(2);
});

test("an unmerged branch with a conflicting change is not merged", async () => {
  await repo.branch("other");
  await commitOn("other", "base.txt", "other change");
  await repo.commit("base.txt", "trunk change\n", "trunk change");
  const facts = await readRepoFacts(repo.path);
  const tip = facts.branches.find((b) => b.name === "other")?.tip ?? "";
  expect(await isMerged(repo.path, tip, facts.trunk.ref)).toBe(false);
});

test("a single gets one level whose parent is the trunk", async () => {
  await repo.worktree(join(repo.path, ".worktrees", "solo"), "solo");
  const features = await readStackFacts(repo.path, await readRepoFacts(repo.path));
  const single = features.find((f) => f.name === "solo");
  expect(single?.kind).toBe("single");
  expect(single?.levels).toHaveLength(1);
  expect(single?.levels[0]).toMatchObject({ branch: "solo", parent: "main", depth: 1, parentMerged: false });
});

test("a deleted parent leaves the child with parentMissing and parentMerged false", async () => {
  await repo.branch("feat/ui", "feat/api");
  await repo.git("config", "branch.feat/ui.stackparent", "feat/api");
  await commitOn("feat/api", "api.txt", "api work");
  await repo.git("merge", "--squash", "feat/api");
  await repo.git("commit", "-m", "squash api");
  await repo.git("branch", "-D", "feat/api");

  const features = await readStackFacts(repo.path, await readRepoFacts(repo.path));
  const ui = features.flatMap((f) => f.levels).find((l) => l.branch === "feat/ui");
  expect(ui).toMatchObject({ parentMissing: true, parentMerged: false });
});

test("a parent with no commits beyond trunk is not merged", async () => {
  await repo.branch("feat/ui", "feat/api");
  await repo.git("config", "branch.feat/ui.stackparent", "feat/api");
  await commitOn("feat/ui", "ui.txt", "ui work");

  const features = await readStackFacts(repo.path, await readRepoFacts(repo.path));
  const ui = features.flatMap((f) => f.levels).find((l) => l.branch === "feat/ui");
  expect(ui).toMatchObject({ parentMerged: false, parentMissing: false });
});

test("a git failure on one level leaves parentMerged false instead of rejecting", async () => {
  await repo.git("switch", "--orphan", "island");
  await repo.commit("island.txt", "island\n", "island root");
  await repo.branch("feat/ui", "island");
  await repo.git("config", "branch.feat/ui.stackparent", "island");
  await repo.git("config", "branch.island.stackparent", "main");
  await commitOn("feat/ui", "ui.txt", "ui work");
  await repo.git("switch", "main");

  const features = await readStackFacts(repo.path, await readRepoFacts(repo.path));
  const ui = features.flatMap((f) => f.levels).find((l) => l.branch === "feat/ui");
  expect(ui?.parentMerged).toBe(false);
});

test("a squash-merged branch stays merged after the trunk edits the same lines", async () => {
  await repo.branch("coupons");
  await commitOn("coupons", "base.txt", "coupons edit");
  await repo.git("merge", "--squash", "coupons");
  await repo.git("commit", "-m", "coupons (#2)");
  await repo.commit("base.txt", "trunk edits it again\n", "follow-up");
  const tip = (await repo.git("rev-parse", "coupons")).trim();
  expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(true);
});

test("a branch with no history in common with the trunk is not merged", async () => {
  await repo.git("switch", "--orphan", "pages");
  const tip = await repo.commit("index.html", "docs\n", "publish docs");
  await repo.git("switch", "main");
  expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(false);
});

async function squashMergeCoupons(): Promise<string> {
  await repo.branch("coupons");
  await commitOn("coupons", "coupons.txt", "coupons work");
  await repo.git("merge", "--squash", "coupons");
  await repo.git("commit", "-m", "coupons (#2)");
  return (await repo.git("rev-parse", "coupons")).trim();
}

test("a squash merge the trunk has since reverted is not merged", async () => {
  const tip = await squashMergeCoupons();
  await repo.git("revert", "--no-edit", "HEAD");
  expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(false);
});

test("a squash merge reverted, landed again and then edited by the trunk is merged", async () => {
  const tip = await squashMergeCoupons();
  await repo.git("revert", "--no-edit", "HEAD");
  await repo.git("revert", "--no-edit", "HEAD");
  await repo.commit("coupons.txt", "coupons work, v2\n", "coupons follow-up");
  expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(true);
});

test("a whitespace-only change that differs from the trunk's is not merged", async () => {
  await repo.commit("f.py", "def f():\n    if x:\n        return 1\n    return 0\n", "add f");
  await repo.branch("indent");
  await repo.switch("indent");
  const tip = await repo.commit("f.py", "def f():\n    if x:\n            return 1\n    return 0\n", "indent return deeper");
  await repo.switch("main");
  await repo.commit("f.py", "def f():\n    if x:\n      return 1\n    return 0\n", "indent return shallower");
  expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(false);
});

test("a branch whose commits cancel out is merged however the trunk moves on", async () => {
  await repo.branch("undo");
  await repo.switch("undo");
  await repo.commit("base.txt", "base, tried\n", "try");
  const tip = await repo.commit("base.txt", "base\n", "undo the try");
  await repo.switch("main");
  await repo.commit("base.txt", "trunk edit\n", "trunk edit");
  await repo.git("commit", "--allow-empty", "-m", "empty");
  expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(true);
});

test("a squash probe whose git output is too large to read counts as not merged", async () => {
  const tip = await squashMergeCoupons();
  await repo.commit("coupons.txt", `coupons work, v2\n${"padding\n".repeat(1000)}`, "coupons follow-up");
  process.env["GIT_GROVE_MAX_BUFFER"] = "4096";
  try {
    expect(await isMerged(repo.path, tip, "refs/heads/main")).toBe(false);
  } finally {
    delete process.env["GIT_GROVE_MAX_BUFFER"];
  }
});
