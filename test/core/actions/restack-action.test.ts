import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { renderReceipt } from "../../../src/cli/render-receipt.js";
import type { ActionContext } from "../../../src/core/actions/action.types.js";
import type { Check, Receipt, StepEvent } from "../../../src/core/actions/plan.types.js";
import { InvalidInputError } from "../../../src/core/actions/invalid-input.error.js";
import { readDirtyPaths } from "../../../src/core/actions/read-dirty-paths.js";
import { prepareAction } from "../../../src/core/actions/registry.js";
import { runPrepared } from "../../../src/core/actions/run-prepared.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { isAncestor } from "../../../src/core/git/is-ancestor.js";
import { parseGitVersion } from "../../../src/core/git/require-git-version.js";
import { observe } from "../../../src/core/journal/observe.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { listPins } from "../../../src/core/runner/list-pins.js";
import { pin } from "../../../src/core/runner/pin.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";
import { makeStack } from "../../support/make-stack.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let store: Store;
let ctx: ActionContext;
let paths: Record<string, string>;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  repo = await makeRepo();
  store = openStore();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("shared.txt", "one\ntwo\nthree\n", "shared");
  paths = await makeStack(repo, {
    feature: "checkout",
    levels: [
      { branch: "feat/model", parent: "main", file: "model.txt" },
      { branch: "feat/ui", parent: "feat/model", file: "ui.txt" },
      { branch: "feat/email", parent: "feat/ui", file: "email.txt" },
    ],
  });
  ctx = { root: (await readRepoFacts(repo.path)).root, store, now: () => Date.now() };
});
afterEach(async () => {
  store.close();
  await repo.cleanup();
});

function folder(branch: string): string {
  const path = paths[branch];
  if (path === undefined) throw new Error(`no worktree for ${branch}`);
  return path;
}

async function commitIn(path: string, file: string, text: string, message: string): Promise<string> {
  await writeFile(join(path, file), text);
  await repo.git("-C", path, "add", "--", file);
  await repo.git("-C", path, "commit", "-m", message);
  return (await repo.git("-C", path, "rev-parse", "HEAD")).trim();
}

async function tip(branch: string): Promise<string> {
  return (await repo.git("rev-parse", `refs/heads/${branch}`)).trim();
}

async function config(key: string): Promise<string> {
  return (await repo.git("config", "--get", key)).trim();
}

/** One more commit on feat/model, so the levels above it drift. */
async function drift(file = "model-2.txt", text = "model again\n"): Promise<void> {
  await commitIn(folder("feat/model"), file, text, "model again");
}

/** feat/admin, level 02 on the drifted feat/model, so it is already up to date. */
async function addAdmin(): Promise<void> {
  Object.assign(
    paths,
    await makeStack(repo, { feature: "checkout", levels: [{ branch: "feat/admin", parent: "feat/model", file: "admin.txt" }] }),
  );
}

async function fixture(): Promise<void> {
  await drift();
  await addAdmin();
}

function restack(stash = false): { feature: string; stash: boolean } {
  return { feature: "checkout", stash };
}

function ignore(): void {}

const [gitMajor, gitMinor] = parseGitVersion(execFileSync("git", ["--version"], { encoding: "utf8" }));

/** The check for a level whose conflicts are predicted: `check` itself from git 2.40, "not checked" before it. */
function predicted(check: Check): Check {
  return gitMajor > 2 || gitMinor >= 40 ? check : { ok: true, text: check.text, why: "Conflicts not checked (needs git 2.40)" };
}

test("plan moves ui then email and leaves admin alone", async () => {
  await fixture();
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.steps.map((step) => step.title)).toEqual([
    "Check nothing moved since you looked",
    "Pin every level that moves",
    "Move feat/ui onto feat/model",
    "Move feat/email onto feat/ui",
    "Check nothing was lost",
  ]);
  expect(plan.checks).toContainEqual(expect.objectContaining({ ok: true, text: "02 feat/ui onto 01 feat/model" }));
  expect(plan.checks).toContainEqual({ ok: true, text: "02 feat/admin is already up to date", why: "Left alone" });
  expect(plan.confirm).toBe("Restack 2 levels");
  expect(plan.moves).toEqual(["feat/ui", "feat/email"]);
  expect(plan.blockers).toEqual([]);
  const rebases = plan.commands.filter((command) => command.includes(" rebase "));
  expect(rebases).toHaveLength(2);
  for (const command of rebases) expect(command).toContain("rebase --no-update-refs --no-autosquash --onto");
  expect(plan.commands).toContain('git -C .worktrees/checkout/02-feat-ui config branch.feat/ui.stackforkpoint "$(git rev-parse feat/model)"');
  expect(plan.commands).toContain('git -C .worktrees/checkout/03-feat-email config branch.feat/email.stackforkpoint "$(git rev-parse feat/ui)"');
});

test("a level whose new base moves in this run has its conflicts checked when it runs", async () => {
  await fixture();
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.checks).toContainEqual(predicted({ ok: true, text: "02 feat/ui onto 01 feat/model", why: "1 commit, no conflicts expected" }));
  expect(plan.checks).toContainEqual({
    ok: true,
    text: "03 feat/email onto 02 feat/ui",
    why: "Conflicts are checked when this level runs",
  });
});

test("a level whose sibling moves first still has its conflict with their parent predicted", async () => {
  await addAdmin();
  await commitIn(folder("feat/admin"), "shared.txt", "admin\ntwo\nthree\n", "admin edits shared");
  await drift("shared.txt", "model\ntwo\nthree\n");
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.moves).toEqual(["feat/ui", "feat/admin", "feat/email"]);
  expect(plan.checks).toContainEqual(predicted({ ok: true, text: "02 feat/ui onto 01 feat/model", why: "1 commit, no conflicts expected" }));
  expect(plan.checks).toContainEqual(predicted({ ok: false, text: "02 feat/admin onto 01 feat/model", why: "conflicts likely in shared.txt" }));
  expect(plan.checks).toContainEqual({
    ok: true,
    text: "03 feat/email onto 02 feat/ui",
    why: "Conflicts are checked when this level runs",
  });
});

test("the plan predicts a conflict on the first level that moves", async () => {
  await commitIn(folder("feat/ui"), "shared.txt", "ui\ntwo\nthree\n", "ui edits shared");
  await drift("shared.txt", "model\ntwo\nthree\n");
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.checks).toContainEqual(predicted({ ok: false, text: "02 feat/ui onto 01 feat/model", why: "conflicts likely in shared.txt" }));
});

async function openAlerts(): Promise<string[]> {
  const repoId = store.findRepoId((await readRepoFacts(repo.path)).commonDir);
  return repoId === null ? [] : store.entries(repoId, { unresolved: true }).map((entry) => entry.branch);
}

test("the run puts each moved level on its parent and records the new fork points", async () => {
  await fixture();
  await observe(repo.path, store);
  const admin = await tip("feat/admin");
  const receipt = await runPrepared(ctx, await prepareAction("restack", ctx, restack()), ignore);
  expect(receipt).toMatchObject({ ok: true, refused: false, title: "Restacked 2 levels" });
  expect(await isAncestor(repo.path, await tip("feat/model"), await tip("feat/ui"))).toBe(true);
  expect(await isAncestor(repo.path, await tip("feat/ui"), await tip("feat/email"))).toBe(true);
  expect(await config("branch.feat/ui.stackforkpoint")).toBe(await tip("feat/model"));
  expect(await config("branch.feat/email.stackforkpoint")).toBe(await tip("feat/ui"));
  expect(await tip("feat/admin")).toBe(admin);
  expect(receipt.pins).toHaveLength(2);
  expect(receipt.undo).toHaveLength(2);
  const changes = await observe(repo.path, store);
  expect(changes.map((change) => `${change.branch} ${change.kind}`).sort()).toEqual(["feat/email rebased", "feat/ui rebased"]);
  expect(await openAlerts()).toEqual([]);
});

test("a level whose tip a pin already holds says already pinned at that pin, in the step and the receipt", async () => {
  await fixture();
  const old = (await pin(repo.path, "feat/ui", await tip("feat/ui"), new Date(Date.UTC(2026, 10, 2, 7, 0, 13)))).ref;
  const events: StepEvent[] = [];
  const receipt = await runPrepared(ctx, await prepareAction("restack", ctx, restack()), (event) => events.push(event));
  expect(receipt.ok).toBe(true);
  const pinStep = events.find((event) => event.index === 1 && event.state === "done");
  expect(pinStep?.detail).toMatch(new RegExp(`^already pinned at ${old}, refs/grove/pins/feat/email/\\d{8}T\\d{6}Z$`));
  expect(receipt.pins).toEqual([{ ref: old, reused: true }, { ref: expect.stringMatching(/^refs\/grove\/pins\/feat\/email\//), reused: false }]);
  expect(renderReceipt(receipt)).toContain(`\n  already pinned at ${old}\n  pinned refs/grove/pins/feat/email/`);
});

test("an uncommitted change blocks unless set aside, and set aside it comes back unchanged", async () => {
  await fixture();
  const ui = folder("feat/ui");
  await writeFile(join(ui, "ui.txt"), "ui, edited\n");
  await repo.git("-C", ui, "add", "ui.txt");
  await writeFile(join(ui, "notes.txt"), "notes\n");
  const before = [await readFile(join(ui, "ui.txt")), await readFile(join(ui, "notes.txt"))];

  const blocked = await prepareAction("restack", ctx, restack(false));
  expect(blocked.plan.blockers[0]).toContain("has uncommitted changes. Turn on set aside, or commit them first.");

  const receipt = await runPrepared(ctx, await prepareAction("restack", ctx, restack(true)), ignore);
  expect(receipt.ok).toBe(true);
  expect([await readFile(join(ui, "ui.txt")), await readFile(join(ui, "notes.txt"))]).toEqual(before);
  expect((await repo.git("-C", ui, "diff", "--cached", "--name-only")).trim()).toBe("ui.txt");
  expect(await repo.git("-C", ui, "stash", "list")).toBe("");
  expect(await isAncestor(repo.path, await tip("feat/model"), await tip("feat/ui"))).toBe(true);
});

test("a conflict on level 03 stops there and keeps level 02 done", async () => {
  const email = folder("feat/email");
  await commitIn(email, "shared.txt", "email\ntwo\nthree\n", "email edits shared");
  await drift("shared.txt", "model\ntwo\nthree\n");
  await addAdmin();
  await writeFile(join(email, "draft.txt"), "draft\n");
  const emailTip = await tip("feat/email");

  const prepared = await prepareAction("restack", ctx, restack(true));
  expect(prepared.plan.checks).toContainEqual({
    ok: true,
    text: "03 feat/email onto 02 feat/ui",
    why: "Conflicts are checked when this level runs",
  });
  const events: StepEvent[] = [];
  const receipt = await runPrepared(ctx, prepared, (event) => events.push(event));

  expect(receipt).toMatchObject({ ok: false, refused: false, title: "Stopped at level 03: conflict in shared.txt" });
  const last = prepared.plan.steps.length - 1;
  expect(prepared.plan.steps[last]?.title).toBe("Check nothing was lost");
  expect(events.filter((event) => event.index === last).map((event) => [event.state, event.detail])).toEqual([
    ["running", "every old commit matched"],
    ["done", "every old commit matched"],
  ]);
  expect(await tip("feat/email")).toBe(emailTip);
  expect(await readFile(join(email, "draft.txt"), "utf8")).toBe("draft\n");
  expect(await readDirtyPaths(email)).toEqual(["draft.txt"]);
  const gitDir = (await repo.git("-C", email, "rev-parse", "--absolute-git-dir")).trim();
  expect(existsSync(join(gitDir, "rebase-merge"))).toBe(false);
  expect(existsSync(join(gitDir, "rebase-apply"))).toBe(false);
  expect(await repo.git("-C", email, "stash", "list")).toBe("");

  expect(await isAncestor(repo.path, await tip("feat/model"), await tip("feat/ui"))).toBe(true);
  expect(receipt.lines).toContain("feat/ui is restacked and stays done");
  expect(await listPins(repo.path, "feat/ui")).toHaveLength(1);
  expect(await listPins(repo.path, "feat/email")).toHaveLength(1);
  expect(receipt.undo?.map((target) => target.branch)).toEqual(["feat/ui"]);
});

test("a set-aside change that no longer applies stays in the stash, and the run stops after that level", async () => {
  await writeFile(join(folder("feat/ui"), "model-2.txt"), "mine\n");
  await fixture();
  const email = await tip("feat/email");
  const receipt = await runPrepared(ctx, await prepareAction("restack", ctx, restack(true)), ignore);
  const stash = (await repo.git("rev-parse", "refs/stash")).trim();

  expect(receipt).toMatchObject({ ok: false, refused: false, title: "Stopped at level 02: your change did not apply cleanly" });
  expect(receipt.lines).toEqual([
    "feat/ui is restacked and stays done",
    `Your change is kept in the stash as ${stash.slice(0, 7)} ("grove restack checkout"). It did not apply cleanly; ` +
      `.worktrees/checkout/02-feat-ui is unchanged. Apply it by hand with git stash apply ${stash}.`,
    "feat/email was not restacked",
  ]);
  expect(await isAncestor(repo.path, await tip("feat/model"), await tip("feat/ui"))).toBe(true);
  expect(await tip("feat/email")).toBe(email);
  expect((await repo.git("stash", "list", "--format=%H %s")).trim()).toBe(`${stash} On feat/ui: grove restack checkout`);
});

test("a set-aside change that conflicts once put back is named by its sha, with the files it left conflicted", async () => {
  const ui = folder("feat/ui");
  await writeFile(join(ui, "shared.txt"), "mine\ntwo\nthree\n");
  await drift("shared.txt", "model\ntwo\nthree\n");
  const receipt = await runPrepared(ctx, await prepareAction("restack", ctx, restack(true)), ignore);
  const stash = (await repo.git("rev-parse", "refs/stash")).trim();

  expect(receipt).toMatchObject({ ok: false, title: "Stopped at level 02: your change did not apply cleanly" });
  expect(receipt.lines).toContain(
    "Your change is partly back in .worktrees/checkout/02-feat-ui: resolve the conflicts in shared.txt, and the rest is " +
      `already in place. The whole change is also kept in the stash as ${stash.slice(0, 7)}, if you need it: git stash apply ${stash}.`,
  );
  expect(receipt.lines.join("\n")).not.toContain("stash drop");
  expect((await repo.git("stash", "list", "--format=%H")).trim()).toBe(stash);
});

test("a parent squash-merged into main moves the child onto main and records main as its parent", async () => {
  await fixture();
  await repo.git("merge", "--squash", "feat/model");
  await repo.git("commit", "-m", "model (#1)");
  await observe(repo.path, store);
  const prepared = await prepareAction("restack", ctx, restack());
  expect(prepared.plan.checks).toContainEqual(expect.objectContaining({ ok: true, text: "02 feat/ui onto main" }));
  expect(prepared.plan.commands).toContain("git -C .worktrees/checkout/02-feat-ui config branch.feat/ui.grovefeature checkout");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt.ok).toBe(true);
  expect(await config("branch.feat/ui.stackparent")).toBe("main");
  expect(await config("branch.feat/ui.grovefeature")).toBe("checkout");
  expect(await config("branch.feat/admin.grovefeature")).toBe("checkout");
  expect((await repo.git("rev-list", "--count", "main..feat/ui")).trim()).toBe("1");
  expect(await isAncestor(repo.path, await tip("feat/ui"), await tip("feat/email"))).toBe(true);
  await observe(repo.path, store);
  expect(await openAlerts()).toEqual([]);

  const again = await prepareAction("restack", ctx, restack());
  const levels = again.plan.expects.flatMap((expect) => (expect.kind === "tip" ? [expect.branch] : []));
  expect(again.plan.context).toBe("checkout");
  expect(levels).toEqual(expect.arrayContaining(["feat/model", "feat/ui", "feat/admin", "feat/email"]));
  expect(again.plan.blockers).toEqual(["Nothing to restack: every level is on top of its parent"]);
});

test("a level with an unresolved rewrite blocks the restack", async () => {
  const email = folder("feat/email");
  await commitIn(email, "email-2.txt", "more\n", "more email");
  await observe(repo.path, store);
  await repo.git("-C", email, "reset", "--soft", "HEAD~2");
  await repo.git("-C", email, "commit", "-m", "email, squashed");
  const [entry] = await observe(repo.path, store);
  expect(entry?.kind).toBe("rewritten");
  await drift();

  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.blockers).toContain("feat/email has a rewrite to restore or keep first");
  expect(plan.blockers.join("\n")).toContain("restore or keep");
});

test("rebase.updateRefs in the user's config moves no other branch", async () => {
  await fixture();
  await repo.git("config", "rebase.updateRefs", "true");
  const ui = await tip("feat/ui");
  await repo.git("branch", "side", "feat/ui");
  const receipt = await runPrepared(ctx, await prepareAction("restack", ctx, restack()), ignore);
  expect(receipt.ok).toBe(true);
  expect(await tip("feat/ui")).not.toBe(ui);
  expect(await tip("side")).toBe(ui);
});

test("a stack with every level on its parent has nothing to restack", async () => {
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.blockers).toEqual(["Nothing to restack: every level is on top of its parent"]);
  expect(plan.moves).toEqual([]);
});

test("a level that moves with no worktree, or mid-operation, blocks the restack", async () => {
  await drift();
  await repo.git("-C", folder("feat/ui"), "bisect", "start");
  await repo.git("worktree", "remove", folder("feat/email"));
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.blockers).toContain("feat/email has no worktree; restack it by hand");
  expect(plan.blockers.join("\n")).toContain("feat/ui has a bisect in progress");
});

test("a feature that is not a stack, or no feature at all, is invalid input", async () => {
  await repo.worktree(join(repo.path, ".worktrees", "solo"), "solo");
  await expect(prepareAction("restack", ctx, { feature: "solo" })).rejects.toThrow(InvalidInputError);
  await expect(prepareAction("restack", ctx, { feature: "nope" })).rejects.toThrow(InvalidInputError);
  await expect(prepareAction("restack", ctx, { feature: "checkout", stash: "yes" })).rejects.toThrow(InvalidInputError);
  await expect(prepareAction("restack", ctx, { stash: true })).rejects.toThrow(InvalidInputError);
});

test("a level that moves after the plan refuses the restack and moves nothing", async () => {
  await fixture();
  const prepared = await prepareAction("restack", ctx, restack());
  const ui = await tip("feat/ui");
  await commitIn(folder("feat/email"), "late.txt", "late\n", "late");
  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
  expect(await tip("feat/ui")).toBe(ui);
});

test("a worktree that switches away from its level after the plan refuses the restack", async () => {
  await fixture();
  const prepared = await prepareAction("restack", ctx, restack());
  const ui = await tip("feat/ui");
  await repo.git("-C", folder("feat/ui"), "switch", "-c", "parked");
  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
  expect(receipt.lines.join("\n")).toContain("no longer has feat/ui checked out");
  expect(await tip("feat/ui")).toBe(ui);
});

test("a level that moves while the run pins is refused before anything moves", async () => {
  await fixture();
  const prepared = await prepareAction("restack", ctx, restack());
  const ui = await tip("feat/ui");
  let raced = false;
  const racing: ActionContext = {
    ...ctx,
    now: () => {
      if (!raced) {
        raced = true;
        const env = { ...process.env, GIT_COMMITTER_NAME: "Racer", GIT_COMMITTER_EMAIL: "racer@example.com" };
        execFileSync("git", ["update-ref", "refs/heads/feat/email", ui], { cwd: repo.path, env });
      }
      return Date.now();
    },
  };
  const receipt = await runPrepared(racing, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
  expect(receipt.lines.join("\n")).toContain("feat/email moved");
  expect(await tip("feat/ui")).toBe(ui);
});

test("a parent with an operation in progress blocks the levels on it", async () => {
  await drift();
  await repo.git("-C", folder("feat/model"), "bisect", "start");
  const { plan } = await prepareAction("restack", ctx, restack());
  expect(plan.blockers).toContain("feat/model has a bisect in progress in .worktrees/checkout/01-feat-model. Finish or abort it first.");
});

test("a change to which levels move refuses the restack before anything moves", async () => {
  const before = await tip("feat/model");
  await fixture();
  const prepared = await prepareAction("restack", ctx, restack());
  const ui = await tip("feat/ui");
  await repo.git("config", "branch.feat/admin.stackforkpoint", before);
  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
  expect(receipt.lines.join("\n")).toContain("The levels that move changed");
  expect(await tip("feat/ui")).toBe(ui);
});

/** A `git` on PATH that runs the real one, except that `rebase --abort` exits 1 or is killed. */
async function gitWhoseAbort(outcome: "fails" | "dies"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "git-grove-bin-"));
  const real = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const stop = outcome === "fails" ? "exit 1" : "kill -9 $$";
  const script = `#!/bin/sh\nfor arg in "$@"; do [ "$arg" = "--abort" ] && ${stop}; done\nexec "${real}" "$@"\n`;
  await writeFile(join(dir, "git"), script, { mode: 0o755 });
  return dir;
}

for (const outcome of ["fails", "dies"] as const) {
  test(`a rebase whose abort ${outcome} keeps the set-aside change in the stash and says so`, async () => {
    const email = folder("feat/email");
    await commitIn(email, "shared.txt", "email\ntwo\nthree\n", "email edits shared");
    await drift("shared.txt", "model\ntwo\nthree\n");
    await writeFile(join(email, "draft.txt"), "draft\n");
    const prepared = await prepareAction("restack", ctx, restack(true));
    const bin = await gitWhoseAbort(outcome);
    const savedPath = process.env["PATH"];
    process.env["PATH"] = `${bin}:${savedPath ?? ""}`;
    let receipt: Receipt | undefined;
    try {
      receipt = await runPrepared(ctx, prepared, ignore);
    } finally {
      process.env["PATH"] = savedPath;
      await rm(bin, { recursive: true, force: true });
    }
    const stash = (await repo.git("rev-parse", "refs/stash")).trim();
    expect(receipt).toMatchObject({ ok: false, title: "Stopped at level 03: conflict in shared.txt" });
    expect(receipt.lines).toContain(".worktrees/checkout/03-feat-email still has a rebase in progress; finish or abort it there");
    expect(receipt.lines).toContain(
      `Your change was not put back, because a rebase is still in progress in .worktrees/checkout/03-feat-email; ` +
        `it is in the stash as ${stash.slice(0, 7)} ("grove restack checkout")`,
    );
    expect(receipt.lines).toContain("feat/ui is restacked and stays done");
    expect((await repo.git("stash", "list", "--format=%H")).trim()).toBe(stash);
  });
}
