import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { GitError } from "../../../src/core/git/git.error.js";
import { runGit } from "../../../src/core/git/run-git.js";
import { classifyTipChange } from "../../../src/core/journal/classify-tip-change.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

let repo: TestRepo;

beforeEach(async () => {
  repo = await makeRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

const sha = async (ref: string): Promise<string> => (await repo.git("rev-parse", ref)).trim();

const classify = (branch: string, oldTip: string, newTip: string, oldBase: string, newBase: string) =>
  classifyTipChange({ cwd: repo.path, branch, oldTip, newTip, oldBase, newBase });

/** Commits a base on main and forks `feat` with three commits; the middle one edits line two of shared.txt. */
async function forkFeature(): Promise<{ fork: string; commits: [string, string, string] }> {
  const fork = await repo.commit("shared.txt", "one\ntwo\nthree\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  const a = await repo.commit("a.txt", "a\n", "add a");
  const b = await repo.commit("shared.txt", "one\ntwo from feat\nthree\n", "edit two");
  const c = await repo.commit("c.txt", "c\n", "add c");
  return { fork, commits: [a, b, c] };
}

/** Commits a base on main and forks `feat` with a, a merge of side branch s, b, then c as the tip. */
async function forkFeatureWithMerge(): Promise<{ fork: string; oldTip: string }> {
  const fork = await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  await repo.commit("a.txt", "a\n", "add a");
  await repo.branch("side");
  await repo.switch("side");
  await repo.commit("s.txt", "s\n", "add s");
  await repo.switch("feat");
  await repo.commit("b.txt", "b\n", "add b");
  await repo.git("merge", "--no-ff", "--no-edit", "-m", "merge side", "side");
  const oldTip = await repo.commit("c.txt", "c\n", "add c");
  return { fork, oldTip };
}

async function moveMain(file: string, text: string): Promise<string> {
  await repo.switch("main");
  const tip = await repo.commit(file, text, "move main");
  await repo.switch("feat");
  return tip;
}

test("fast-forward is advanced", async () => {
  const { fork, commits } = await forkFeature();
  const newTip = await repo.commit("d.txt", "d\n", "add d");

  expect(await classify("feat", commits[2], newTip, fork, fork)).toEqual({
    branch: "feat",
    oldTip: commits[2],
    newTip,
    kind: "advanced",
    lost: [],
    matchedByPatch: 0,
    matchedByMeta: 0,
  });
});

test("rebase onto moved main is rebased, every commit matched by patch", async () => {
  const { fork, commits } = await forkFeature();
  const main = await moveMain("main.txt", "main\n");
  await repo.git("rebase", "main");

  const change = await classify("feat", commits[2], await sha("feat"), fork, main);
  expect(change).toMatchObject({ kind: "rebased", lost: [], matchedByPatch: 3, matchedByMeta: 0 });
});

test("rebase that resolved a conflict is rebased, the resolved commit matched by metadata", async () => {
  const { fork, commits } = await forkFeature();
  const main = await moveMain("shared.txt", "one\ntwo from main\nthree\n");
  await expect(repo.git("rebase", "main")).rejects.toThrow(GitError);
  await writeFile(join(repo.path, "shared.txt"), "one\ntwo from both\nthree\n");
  await repo.git("add", "shared.txt");
  await runGit(["rebase", "--continue"], { cwd: repo.path, write: true, env: { ...IDENTITY, GIT_EDITOR: "true" } });

  const change = await classify("feat", commits[2], await sha("feat"), fork, main);
  expect(change).toMatchObject({ kind: "rebased", lost: [], matchedByPatch: 2, matchedByMeta: 1 });
});

test("amending the tip with its message kept is amended", async () => {
  const { fork, commits } = await forkFeature();
  await writeFile(join(repo.path, "c.txt"), "c, amended\n");
  await repo.git("add", "c.txt");
  await repo.git("commit", "--amend", "--no-edit");

  const change = await classify("feat", commits[2], await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "amended", lost: [], matchedByPatch: 2, matchedByMeta: 1 });
});

test("amending the tip with its message edited is amended", async () => {
  const { fork, commits } = await forkFeature();
  await writeFile(join(repo.path, "c.txt"), "c, amended\n");
  await repo.git("add", "c.txt");
  await repo.git("commit", "--amend", "-m", "add c, reworded");

  const change = await classify("feat", commits[2], await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "amended", lost: [], matchedByPatch: 2, matchedByMeta: 0 });
});

test("amending the tip with a reset author and its message kept is amended", async () => {
  const { fork, commits } = await forkFeature();
  await writeFile(join(repo.path, "c.txt"), "c, amended\n");
  await repo.git("add", "c.txt");
  await repo.git("commit", "--amend", "--reset-author", "--no-edit");

  const change = await classify("feat", commits[2], await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "amended", lost: [], matchedByPatch: 2, matchedByMeta: 0 });
});

test("dropping the middle commit is rewritten with that commit lost", async () => {
  const { fork, commits } = await forkFeature();
  await repo.git("rebase", "--onto", commits[0], commits[1], "feat");

  const change = await classify("feat", commits[2], await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "rewritten", lost: [commits[1]] });
});

test("dropping the tip commit with nothing in its place is rewritten with that commit lost", async () => {
  const { fork, commits } = await forkFeature();
  await repo.git("reset", "--hard", commits[1]);

  const change = await classify("feat", commits[2], commits[1], fork, fork);
  expect(change).toMatchObject({ kind: "rewritten", lost: [commits[2]] });
});

test("dropping the tip and committing something unrelated is rewritten with the tip lost", async () => {
  const { fork, commits } = await forkFeature();
  await repo.git("reset", "--hard", commits[1]);
  const newTip = await repo.commit("d.txt", "d\n", "add d");

  const change = await classify("feat", commits[2], newTip, fork, fork);
  expect(change).toMatchObject({ kind: "rewritten", lost: [commits[2]] });
});

test("squashing three commits into one is rewritten with all three lost", async () => {
  const { fork, commits } = await forkFeature();
  await repo.git("reset", "--soft", fork);
  await repo.git("commit", "-m", "squashed");

  const change = await classify("feat", commits[2], await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "rewritten", lost: commits, matchedByPatch: 0, matchedByMeta: 0 });
});

test("a child restacked after its parent was squash-merged is rebased", async () => {
  await repo.commit("base.txt", "base\n", "base");
  await repo.branch("parent");
  await repo.switch("parent");
  await repo.commit("p1.txt", "p1\n", "add p1");
  const parentTip = await repo.commit("p2.txt", "p2\n", "add p2");
  await repo.branch("child");
  await repo.switch("child");
  await repo.commit("k1.txt", "k1\n", "add k1");
  const childTip = await repo.commit("k2.txt", "k2\n", "add k2");
  await repo.switch("main");
  await repo.git("merge", "--squash", "parent");
  await repo.git("commit", "-m", "parent, squashed");
  const main = await sha("main");
  await repo.git("rebase", "--onto", "main", parentTip, "child");

  const change = await classify("child", childTip, await sha("child"), parentTip, main);
  expect(change).toMatchObject({ kind: "rebased", lost: [], matchedByPatch: 2 });
});

test("a merge commit in the own range, rebased with --rebase-merges, is rebased", async () => {
  const { fork, oldTip } = await forkFeatureWithMerge();
  const main = await moveMain("main.txt", "main\n");
  await repo.git("rebase", "--rebase-merges", "main");

  const change = await classify("feat", oldTip, await sha("feat"), fork, main);
  expect(change).toMatchObject({ kind: "rebased", lost: [], matchedByPatch: 4, matchedByMeta: 1 });
});

test("a clean merge commit linearized away by a plain rebase is rebased", async () => {
  const { fork, oldTip } = await forkFeatureWithMerge();
  const main = await moveMain("main.txt", "main\n");
  await repo.git("rebase", "main");

  const change = await classify("feat", oldTip, await sha("feat"), fork, main);
  expect(change).toMatchObject({ kind: "rebased", lost: [], matchedByPatch: 4, matchedByMeta: 0 });
});

test("amending the tip with its message edited, below a merge commit, is amended", async () => {
  const { fork, oldTip } = await forkFeatureWithMerge();
  await writeFile(join(repo.path, "c.txt"), "c, amended\n");
  await repo.git("add", "c.txt");
  await repo.git("commit", "--amend", "-m", "add c, reworded");

  const change = await classify("feat", oldTip, await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "amended", lost: [] });
});

test("a commit cherry-picked to main and then dropped by a rebase onto main is rebased", async () => {
  const { fork, commits } = await forkFeature();
  await repo.switch("main");
  await repo.git("cherry-pick", commits[1]);
  const main = await sha("main");
  await repo.switch("feat");
  await repo.git("rebase", "main");
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("2");

  const change = await classify("feat", commits[2], await sha("feat"), fork, main);
  expect(change).toMatchObject({ kind: "rebased", lost: [] });
});

/** Runs `git rebase -i --autosquash <onto>` with the todo list accepted as generated. */
async function autosquash(onto: string): Promise<void> {
  await runGit(["rebase", "-i", "--autosquash", onto], {
    cwd: repo.path,
    write: true,
    env: { ...IDENTITY, GIT_SEQUENCE_EDITOR: "true", GIT_EDITOR: "true" },
  });
}

test("fixup! and squash! commits folded by --autosquash are not lost", async () => {
  const { fork } = await forkFeature();
  await repo.commit("a.txt", "a, fixed\n", "fixup! add a");
  const oldTip = await repo.commit("c.txt", "c, more\n", "squash! add c");
  await autosquash(fork);
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("3");

  const change = await classify("feat", oldTip, await sha("feat"), fork, fork);
  expect(change).toMatchObject({ kind: "rebased", lost: [] });
});

test("a fixup! commit whose target is gone from the branch is lost", async () => {
  const { fork } = await forkFeature();
  const fixup = await repo.commit("a.txt", "a, fixed\n", "fixup! add a");
  await repo.git("reset", "--hard", fork);
  const newTip = await repo.commit("d.txt", "d\n", "add d");

  const change = await classify("feat", fixup, newTip, fork, fork);
  expect(change.kind).toBe("rewritten");
  expect(change.lost).toContain(fixup);
});
