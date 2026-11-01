import { mkdir, mkdtemp, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readEnvMissing } from "../../../src/core/facts/read-env-missing.js";
import { readRemovalFacts } from "../../../src/core/facts/read-removal-facts.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { MainWorktreeError } from "../../../src/core/facts/main-worktree.error.js";
import { safeToRemove } from "../../../src/core/rules/safe-to-remove.js";
import type { Verdict } from "../../../src/core/rules/verdict.types.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
let root: string;

async function write(path: string, text: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

async function verdictFor(path: string): Promise<Verdict> {
  const facts = await readRepoFacts(root);
  return safeToRemove(await readRemovalFacts(root, path, facts));
}

beforeEach(async () => {
  repo = await makeRepo();
  root = await realpath(repo.path);
  await repo.commit(".gitignore", ".worktrees/\n.local/\nnode_modules/\n.env*\nout/\n", "ignore");
  await repo.commit("f.txt", "base\n", "base");
  await write(join(root, ".env"), "KEY=1\n");
});

afterEach(() => repo.cleanup());

async function mergedWorktree(name: string): Promise<string> {
  const path = join(root, ".worktrees", name);
  await repo.worktree(path, name);
  return path;
}

test("a clean merged worktree holding .local/seed.sql is not safe", async () => {
  const wt = await mergedWorktree("seeded");
  await write(join(wt, ".local", "seed.sql"), "insert;\n");
  const verdict = await verdictFor(wt);
  expect(verdict.ok).toBe(false);
  expect(verdict.reasons).toEqual([
    expect.objectContaining({ code: "precious-ignored", paths: [".local/seed.sql"] }),
  ]);
});

test("node_modules and an .env identical to main's are safe", async () => {
  const wt = await mergedWorktree("tidy");
  await write(join(wt, "node_modules", "x.js"), "x\n");
  await write(join(wt, ".env"), "KEY=1\n");
  expect(await verdictFor(wt)).toEqual({ ok: true, reasons: [] });
});

test("an .env that differs from main's is precious", async () => {
  const wt = await mergedWorktree("diverged");
  await write(join(wt, ".env"), "KEY=2\n");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons.map((reason) => reason.code)).toEqual(["precious-ignored"]);
  expect(verdict.reasons[0]?.paths).toEqual([".env"]);
});

test("a worktree folder inside another worktree is nested-worktree", async () => {
  const outer = await mergedWorktree("outer");
  const inner = join(outer, "inner");
  await repo.git("worktree", "add", "-b", "inner", inner);
  const verdict = await verdictFor(outer);
  expect(verdict.reasons).toEqual([expect.objectContaining({ code: "nested-worktree", paths: [inner] })]);
});

test("a detached commit on no branch is detached-only", async () => {
  const wt = join(root, ".worktrees", "loose");
  await repo.git("worktree", "add", "--detach", wt);
  await write(join(wt, "g.txt"), "g\n");
  await repo.git("-C", wt, "add", "g.txt");
  await repo.git("-C", wt, "commit", "-m", "loose");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons.map((reason) => reason.code)).toEqual(["detached-only"]);
});

test("2,001 files in an ignored folder give too-many-ignored", async () => {
  const wt = await mergedWorktree("big");
  for (let i = 0; i < 2001; i++) await write(join(wt, "out", `f${i}.txt`), "x");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons).toEqual([expect.objectContaining({ code: "too-many-ignored", paths: [] })]);
});

test("uncommitted, untracked, unpushed and stash each give a reason", async () => {
  const wt = await mergedWorktree("busy");
  await write(join(wt, "f.txt"), "edited\n");
  await repo.git("-C", wt, "stash");
  await write(join(wt, "f.txt"), "edited again\n");
  await write(join(wt, "new.txt"), "n\n");
  await write(join(wt, "c.txt"), "c\n");
  await repo.git("-C", wt, "add", "c.txt");
  await repo.git("-C", wt, "commit", "-m", "ahead");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons.map((reason) => reason.code)).toEqual(["uncommitted", "untracked", "unpushed", "stash"]);
  expect(verdict.reasons[1]?.paths).toEqual(["new.txt"]);
});

test("the main worktree is refused", async () => {
  const facts = await readRepoFacts(root);
  await expect(readRemovalFacts(root, root, facts)).rejects.toBeInstanceOf(MainWorktreeError);
});

test("readEnvMissing reports ignored .env files absent from a worktree", async () => {
  await write(join(root, "apps", "web", ".env.local"), "A=1\n");
  const wt = await mergedWorktree("lacking");
  await write(join(wt, ".env"), "KEY=1\n");
  const missing = await readEnvMissing(root, await readRepoFacts(root));
  expect(missing.get(wt)).toEqual(["apps/web/.env.local"]);
});

test("untracked files are found even when status.showUntrackedFiles is no", async () => {
  const wt = await mergedWorktree("quiet");
  await repo.git("config", "status.showUntrackedFiles", "no");
  await write(join(wt, "notes.txt"), "mine\n");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons).toEqual([expect.objectContaining({ code: "untracked", paths: ["notes.txt"] })]);
});

test("a failed read is unreadable, never zero", async () => {
  const wt = await mergedWorktree("broken");
  const facts = await readRepoFacts(root);
  const elsewhere = await mkdtemp(join(tmpdir(), "grove-not-a-repo-"));
  const moved = { ...facts, worktrees: facts.worktrees.map((w) => (w.path === wt ? { ...w, path: elsewhere } : w)) };
  const verdict = safeToRemove(await readRemovalFacts(root, elsewhere, moved));
  expect(verdict.ok).toBe(false);
  expect(verdict.reasons.map((reason) => reason.code)).toContain("unreadable");
});

test("a branch whose upstream is gone still reports its local commits", async () => {
  const remote = await mkdtemp(join(tmpdir(), "grove-remote-"));
  await repo.git("init", "--bare", "-b", "main", remote);
  await repo.git("remote", "add", "origin", remote);
  await repo.git("push", "origin", "main");
  const wt = await mergedWorktree("tracked");
  await repo.git("-C", wt, "push", "-u", "origin", "tracked");
  await write(join(wt, "t.txt"), "t\n");
  await repo.git("-C", wt, "add", "t.txt");
  await repo.git("-C", wt, "commit", "-m", "local only");
  await repo.git("push", "origin", "--delete", "tracked");
  await repo.git("fetch", "--prune");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons.map((reason) => reason.code)).toEqual(["unpushed"]);
});

test("a tag named like the branch does not hide its commits", async () => {
  await repo.git("tag", "feat");
  const wt = join(root, ".worktrees", "feat");
  await repo.git("worktree", "add", "-b", "feat", wt, "main");
  await write(join(wt, "q.txt"), "q\n");
  await repo.git("-C", wt, "add", "q.txt");
  await repo.git("-C", wt, "commit", "-m", "on feat");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons.map((reason) => reason.code)).toEqual(["unpushed"]);
});

test("a worktree whose folder was deleted still gets a verdict", async () => {
  const wt = await mergedWorktree("vanished");
  await rename(wt, `${wt}-gone`);
  const verdict = await verdictFor(wt);
  expect(verdict).toEqual({ ok: true, reasons: [] });
});

test("default folder names inside a precious folder do not hide its files", async () => {
  const wt = await mergedWorktree("deep");
  await write(join(wt, ".local", "build", "seed.sql"), "s\n");
  await write(join(wt, ".local", "coverage", "notes.md"), "n\n");
  const verdict = await verdictFor(wt);
  expect(verdict.reasons).toEqual([
    expect.objectContaining({ code: "precious-ignored", paths: expect.arrayContaining([".local/build/seed.sql", ".local/coverage/notes.md"]) }),
  ]);
});

test("a symlinked .env is never precious", async () => {
  const wt = await mergedWorktree("linked");
  await symlink(join(root, ".env"), join(wt, ".env"));
  expect(await verdictFor(wt)).toEqual({ ok: true, reasons: [] });
});

test("env discovery is not capped by unrelated ignored files", async () => {
  await write(join(root, "apps", "web", ".env.local"), "A=1\n");
  for (let i = 0; i < 30; i++) await write(join(root, "out", `f${i}.txt`), "x");
  const wt = await mergedWorktree("capped");
  const missing = await readEnvMissing(root, await readRepoFacts(root), 10);
  expect(missing.get(wt)).toEqual(expect.arrayContaining(["apps/web/.env.local"]));
});
