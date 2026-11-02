import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GuardDecision } from "../../../src/core/guard/guard-decision.types.js";
import { evaluateCommandLine } from "../../../src/core/guard/evaluate-command-line.js";
import { listPins } from "../../../src/core/runner/list-pins.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const HOME = "/home/robin";

let repo: TestRepo;
let root: string;

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function evaluate(command: string, cwd: string = root): Promise<GuardDecision> {
  return evaluateCommandLine({ command, cwd, home: HOME });
}

async function expectBlocked(command: string, cwd: string = root): Promise<string> {
  const decision = await evaluate(command, cwd);
  if (decision.verdict !== "block") throw new Error(`expected ${command} to be blocked`);
  return decision.message;
}

async function expectAllowed(command: string, cwd: string = root): Promise<GuardDecision & { verdict: "allow" }> {
  const decision = await evaluate(command, cwd);
  if (decision.verdict !== "allow") throw new Error(`expected ${command} to be allowed, got: ${decision.message}`);
  return decision;
}

beforeEach(async () => {
  repo = await makeRepo();
  root = await realpath(repo.path);
  await repo.commit(".gitignore", ".worktrees/\n.local/\nnode_modules/\n", "ignore");
  await repo.commit("base.txt", "base\n", "base");
});

afterEach(() => repo.cleanup());

/** A worktree on a branch merged into main, holding the only copy of an ignored `.local/seed.sql`. */
async function preciousWorktree(name = "x"): Promise<string> {
  const path = join(root, ".worktrees", name);
  await repo.worktree(path, name);
  await write(join(path, ".local", "seed.sql"), "insert into coupons values ('WELCOME10', 10);\n");
  return path;
}

test("git worktree remove --force of a merged worktree holding a precious ignored file is blocked", async () => {
  await preciousWorktree();
  const message = await expectBlocked("git worktree remove --force .worktrees/x");
  expect(message).toBe(
    "git grove blocked: .worktrees/x is not safe to remove: it holds 1 ignored file that exists only here (.local/seed.sql).\n" +
      "Run: git grove rm --rescue .worktrees/x",
  );
});

test("git worktree remove of a worktree by its bare name, as git resolves it, is blocked from the root", async () => {
  await preciousWorktree();
  expect(await expectBlocked("git worktree remove --force x")).toContain(".worktrees/x is not safe to remove");
  expect(await expectBlocked("git worktree remove x")).toContain(".worktrees/x is not safe to remove");
});

test("git worktree remove by bare name is blocked from a sibling worktree", async () => {
  await preciousWorktree();
  const sibling = join(root, ".worktrees", "sibling");
  await repo.worktree(sibling, "sibling");
  expect(await expectBlocked("git worktree remove --force x", sibling)).toContain("../x is not safe to remove");
});

test("git -C <repo> worktree remove -f <name> from the parent folder is blocked", async () => {
  await preciousWorktree();
  const message = await expectBlocked(`git -C ${basename(root)} worktree remove -f x`, dirname(root));
  expect(message).toContain(".local/seed.sql");
});

test("from outside the repository, the rescue hint runs git grove through git -C", async () => {
  await preciousWorktree();
  const outside = dirname(root);
  const hint = `Run: git -C ${basename(root)} grove rm --rescue .worktrees/x`;
  expect(await expectBlocked(`git -C ${basename(root)} worktree remove -f x`, outside)).toContain(hint);
  expect(await expectBlocked(`rm -rf ${basename(root)}/.worktrees/x`, outside)).toContain(hint);
});

test("rm -rf of a symlink to a worktree removes only the link and is allowed; with a trailing slash it is blocked", async () => {
  await preciousWorktree();
  await symlink(join(root, ".worktrees", "x"), join(root, "link"));
  await expectAllowed("rm -rf link");
  expect(await expectBlocked("rm -rf link/")).toContain("not safe to remove");
});

test("cd .worktrees && rm -rf x is blocked, with the path as seen from where the agent stands", async () => {
  await preciousWorktree();
  const message = await expectBlocked("cd .worktrees && rm -rf x");
  expect(message).toContain(".worktrees/x is not safe to remove");
  expect(message).toContain("Run: git grove rm --rescue .worktrees/x");
});

test("rm -rf .worktrees, which holds the worktree, is blocked", async () => {
  await preciousWorktree();
  const message = await expectBlocked("rm -rf .worktrees");
  expect(message).toContain("git grove blocked: .worktrees holds a worktree that is not safe to remove");
  expect(message).toContain(".worktrees/x: it holds 1 ignored file that exists only here (.local/seed.sql)");
});

test("rm -rf .worktrees/* is blocked like the folder it expands into", async () => {
  await preciousWorktree();
  expect(await expectBlocked("rm -rf .worktrees/*")).toContain(".worktrees/x");
});

test("rm -rf node_modules, which holds no worktree, is allowed", async () => {
  await preciousWorktree();
  await write(join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  expect(await expectAllowed("rm -rf node_modules")).toEqual({ verdict: "allow", unchecked: false, pins: [] });
});

test("an rm -rf of the folder holding the main worktree is always blocked", async () => {
  const inside = await preciousWorktree();
  expect(await expectBlocked(`rm -rf ${root}`, inside)).toContain("the main worktree");
});

test("git grove rm --rescue of that worktree is allowed", async () => {
  await preciousWorktree();
  expect((await expectAllowed("git grove rm --rescue .worktrees/x")).pins).toEqual([]);
});

test("removing a worktree that is safe to remove is allowed", async () => {
  await repo.worktree(join(root, ".worktrees", "tidy"), "tidy");
  expect(await expectAllowed("git worktree remove .worktrees/tidy")).toEqual({ verdict: "allow", unchecked: false, pins: [] });
  expect(await expectAllowed("rm -rf .worktrees/tidy")).toEqual({ verdict: "allow", unchecked: false, pins: [] });
});

test("git reset --hard with uncommitted changes is blocked", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  await write(join(root, "staged.txt"), "new\n");
  await repo.git("add", "staged.txt");
  expect(await expectBlocked("git reset --hard")).toBe(
    "git grove blocked: this worktree has 2 uncommitted changes that git reset --hard would discard. " +
      "Commit them, or run git stash on its own first, then retry.",
  );
});

test("from a folder inside the worktree, the block still names this worktree", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  await mkdir(join(root, "src"));
  expect(await expectBlocked("git reset --hard", join(root, "src"))).toMatch(/^git grove blocked: this worktree has 1 uncommitted change/);
});

test("a git stash earlier in the same line does not let a discard through", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  for (const line of ["git stash && git reset --hard", "git stash; git checkout -- .", "git stash push -- base.txt && git reset --hard"]) {
    expect(await expectBlocked(line), line).toContain("on its own first, then retry");
  }
});

/** Leaves main mid-merge with base.txt conflicted. */
async function conflictedMerge(): Promise<void> {
  await repo.branch("theirs");
  await repo.switch("theirs");
  await repo.commit("base.txt", "theirs\n", "theirs");
  await repo.switch("main");
  await repo.commit("base.txt", "ours\n", "ours");
  await repo.git("merge", "theirs").catch(() => undefined);
}

test("git's conflict tools are allowed mid-merge: --ours, --theirs, -m and --conflict", async () => {
  await conflictedMerge();
  for (const line of [
    "git checkout --theirs -- base.txt",
    "git checkout --ours .",
    "git restore --theirs base.txt",
    "git checkout -m -- base.txt",
    "git checkout --merge base.txt",
    "git restore --conflict=diff3 base.txt",
  ]) {
    expect((await evaluate(line)).verdict, line).toBe("allow");
  }
});

test("a path-scoped discard does not count unmerged paths; reset --hard does", async () => {
  await conflictedMerge();
  await expectAllowed("git checkout -- base.txt");
  expect(await expectBlocked("git reset --hard")).toContain("has 1 uncommitted change that git reset --hard would discard");
});

test("a discard mid-operation is blocked with the abort that keeps your own changes", async () => {
  await conflictedMerge();
  expect(await expectBlocked("git reset --hard")).toBe(
    "git grove blocked: this worktree has 1 uncommitted change that git reset --hard would discard. " +
      "A merge is in progress. To drop it and keep your own uncommitted changes, run: git merge --abort",
  );
  await repo.git("merge", "--abort");

  await repo.switch("theirs");
  await repo.git("rebase", "main").catch(() => undefined);
  expect(await expectBlocked("git reset --hard")).toContain("A rebase is in progress. To drop it and keep your own uncommitted changes, run: git rebase --abort");
  await repo.git("rebase", "--abort");

  await repo.switch("main");
  await repo.git("cherry-pick", "theirs").catch(() => undefined);
  expect(await expectBlocked("git checkout -f")).toContain("A cherry-pick is in progress. To drop it and keep your own uncommitted changes, run: git cherry-pick --abort");
  await repo.git("cherry-pick", "--abort");

  await repo.commit("base.txt", "later\n", "later");
  await repo.git("revert", "--no-edit", "HEAD~1").catch(() => undefined);
  expect(await expectBlocked("git reset --hard")).toContain("A revert is in progress. To drop it and keep your own uncommitted changes, run: git revert --abort");
});

test("git checkout <path> without -- is a discard; a lone branch name is a switch", async () => {
  await repo.branch("feat");
  await writeFile(join(root, "base.txt"), "edited\n");
  expect(await expectBlocked("git checkout base.txt")).toContain("has 1 uncommitted change that git checkout base.txt would discard");
  expect(await expectBlocked("git checkout HEAD base.txt")).toContain("git checkout HEAD base.txt would discard");
  await expectAllowed("git checkout feat");
  await expectAllowed("git checkout .gitignore");
});

test("checkout -f, switch -f and switch --discard-changes are blocked while there are changes", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  for (const line of ["git checkout -f", "git checkout -f HEAD~1", "git checkout --force --detach", "git switch -f --detach HEAD", "git switch --discard-changes --detach HEAD"]) {
    expect(await expectBlocked(line), line).toContain("Commit them, or run git stash on its own first, then retry.");
  }
});

test("a discard of named paths says how to keep a copy of just those paths", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  expect(await expectBlocked("git checkout -- base.txt")).toBe(
    "git grove blocked: this worktree has 1 uncommitted change that git checkout -- base.txt would discard. " +
      "To keep a copy, run git stash push -- base.txt on its own first, then retry.",
  );
});

test("changes inside a submodule do not count against a reset of the superproject", async () => {
  const library = await makeRepo();
  try {
    await library.commit("lib.txt", "lib\n", "lib");
    await repo.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", library.path, "lib");
    await repo.git("commit", "-q", "-m", "add lib");
    await writeFile(join(root, "lib", "lib.txt"), "edited inside the submodule\n");
    await expectAllowed("git reset --hard");
  } finally {
    await library.cleanup();
  }
});

test("git reset --hard HEAD~1 on a clean tree is allowed and pins the old tip", async () => {
  const tip = (await repo.git("rev-parse", "HEAD")).trim();
  const decision = await expectAllowed("git reset --hard HEAD~1");
  const pins = await listPins(root, "main");
  expect(pins.map((pin) => pin.sha)).toEqual([tip]);
  expect(decision.pins).toEqual([expect.objectContaining({ branch: "main", ref: pins[0]?.ref, reused: false, verb: "git reset --hard" })]);
});

test("git reset --hard on a clean tree that moves nothing pins nothing", async () => {
  expect((await expectAllowed("git reset --hard HEAD")).pins).toEqual([]);
  expect(await listPins(root)).toEqual([]);
});

test("git checkout -- . with changes is blocked", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  expect(await expectBlocked("git checkout -- .")).toContain("has 1 uncommitted change that git checkout -- . would discard");
});

test("git checkout -- of a path with no changes is allowed while another path has some", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  await expectAllowed("git checkout -- .gitignore");
});

test("git restore --staged is allowed; git restore of a changed file is blocked", async () => {
  await writeFile(join(root, "base.txt"), "edited\n");
  await repo.git("add", "base.txt");
  await expectAllowed("git restore --staged base.txt");
  await writeFile(join(root, "base.txt"), "edited again\n");
  expect(await expectBlocked("git restore base.txt")).toContain("git restore base.txt would discard");
});

test("git rebase main pins the branch's tip, then allows", async () => {
  const path = join(root, ".worktrees", "feat");
  await repo.worktree(path, "feat");
  await write(join(path, "feat.txt"), "feat\n");
  await repo.git("-C", path, "add", "feat.txt");
  await repo.git("-C", path, "commit", "-m", "feat");
  const tip = (await repo.git("rev-parse", "feat")).trim();
  const decision = await expectAllowed("git rebase main", path);
  expect(decision.pins).toEqual([expect.objectContaining({ branch: "feat", reused: false, verb: "git rebase" })]);
  expect((await listPins(root, "feat")).map((pin) => pin.sha)).toEqual([tip]);
});

test("rebasing twice from the same tip reuses the first pin", async () => {
  await expectAllowed("git rebase main");
  expect((await expectAllowed("git rebase main")).pins).toEqual([expect.objectContaining({ branch: "main", reused: true })]);
  expect(await listPins(root, "main")).toHaveLength(1);
});

test("git branch -D feat pins feat", async () => {
  await repo.branch("feat");
  await repo.switch("feat");
  const tip = await repo.commit("feat.txt", "feat\n", "feat");
  await repo.switch("main");
  const decision = await expectAllowed("git branch -D feat");
  expect(decision.pins).toEqual([expect.objectContaining({ branch: "feat", verb: "git branch -D" })]);
  expect((await listPins(root, "feat")).map((pin) => pin.sha)).toEqual([tip]);
});

test("git push --force origin feat pins the remote tip it would replace, under feat", async () => {
  const remote = await mkdtemp(join(tmpdir(), "git-grove-remote-"));
  try {
    await repo.git("init", "--bare", "-b", "main", remote);
    await repo.git("remote", "add", "origin", remote);
    await repo.branch("feat");
    await repo.switch("feat");
    const pushed = await repo.commit("feat.txt", "feat\n", "feat");
    await repo.git("push", "-q", "origin", "feat");
    await repo.git("commit", "--amend", "-q", "-m", "feat, amended");
    const decision = await expectAllowed("git push --force origin feat");
    expect(decision.pins).toEqual([expect.objectContaining({ branch: "feat", verb: "git push --force" })]);
    expect((await listPins(root, "feat")).map((pin) => pin.sha)).toEqual([pushed]);
    await repo.git("push", "-q", "--force", "origin", "feat");
    expect((await expectAllowed("git push --force origin feat")).pins).toEqual([]);
  } finally {
    await rm(remote, { recursive: true, force: true });
  }
});

test("git grove ack feat is blocked", async () => {
  expect(await expectBlocked("git grove ack feat")).toContain("git grove blocked: git grove ack marks a rewrite");
});

test("the first block in a line wins and nothing after it is pinned", async () => {
  await preciousWorktree();
  await expectBlocked("git rebase main; git worktree remove .worktrees/x; git branch -D x");
  expect(await listPins(root, "x")).toEqual([]);
});

test("a line the guard cannot read is allowed and marked unchecked", async () => {
  expect(await expectAllowed("eval git reset --hard")).toEqual({ verdict: "allow", unchecked: true, pins: [] });
  expect(await expectAllowed('rm -rf "$TMPDIR/x"')).toEqual({ verdict: "allow", unchecked: true, pins: [] });
  expect(await expectAllowed('rm -rf "$(git rev-parse --show-toplevel)/.worktrees/x"')).toEqual({ verdict: "allow", unchecked: true, pins: [] });
});

const COMMIT_FORM = "git commit --allow-empty -m \"$(cat <<'EOF'\nchore: tidy\n\nWith care.\nEOF\n)\"";

test("the commands around and inside a substitution are checked, Claude Code's commit form included", async () => {
  await preciousWorktree("precious");
  await writeFile(join(root, "base.txt"), "edited\n");
  for (const line of [
    `${COMMIT_FORM} && git worktree remove --force .worktrees/precious`,
    'echo "started $(date)" && rm -rf .worktrees/precious',
    "X=$(pwd) && rm -rf .worktrees/precious",
    "echo $((1+1)); git reset --hard",
    "echo $(rm -rf .worktrees/precious)",
    "echo `rm -rf .worktrees/precious`",
  ]) {
    expect((await evaluate(line)).verdict, line).toBe("block");
  }
});

test("Claude Code's commit form followed by a force push pins the branch", async () => {
  const remote = await mkdtemp(join(tmpdir(), "git-grove-remote-"));
  try {
    await repo.git("init", "--bare", "-b", "main", remote);
    await repo.git("remote", "add", "origin", remote);
    await repo.branch("feat");
    await repo.switch("feat");
    const pushed = await repo.commit("feat.txt", "feat\n", "feat");
    await repo.git("push", "-q", "origin", "feat");
    await repo.git("commit", "--amend", "-q", "-m", "feat, amended");
    const decision = await expectAllowed(`${COMMIT_FORM} && git push --force origin feat`);
    expect(decision).toMatchObject({ unchecked: false, pins: [expect.objectContaining({ branch: "feat", verb: "git push --force" })] });
    expect((await listPins(root, "feat")).map((pin) => pin.sha)).toEqual([pushed]);
  } finally {
    await rm(remote, { recursive: true, force: true });
  }
});

test("a cd to a glob or a GIT_DIR prefix leaves the command unchecked, not judged in the wrong folder", async () => {
  await preciousWorktree("precious");
  expect(await expectAllowed("cd .worktr* && rm -rf precious")).toMatchObject({ unchecked: true });
  await writeFile(join(root, "base.txt"), "edited\n");
  expect(await expectAllowed(`GIT_DIR=${root}/.git GIT_WORK_TREE=${root} git reset --hard`, tmpdir())).toMatchObject({ unchecked: true });
});

test("an rm whose braces expand past 256 words is unchecked, and answers at once", async () => {
  await preciousWorktree();
  const started = Date.now();
  expect(await expectAllowed("rm -rf .worktrees/x{1..9}{1..9}{1..9}{1..9}{1..9}")).toMatchObject({ unchecked: true });
  expect(Date.now() - started).toBeLessThan(1000);
});

test("commands that are not guarded run no git at all", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    expect(await expectAllowed("ls -la && npm test", outside)).toEqual({ verdict: "allow", unchecked: false, pins: [] });
    expect(await expectAllowed("rm -rf build", outside)).toEqual({ verdict: "allow", unchecked: false, pins: [] });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
