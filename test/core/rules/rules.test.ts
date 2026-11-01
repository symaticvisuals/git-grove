import { expect, test } from "vitest";
import type { RepoFacts, WorktreeFacts } from "../../../src/core/facts/facts.types.js";
import type { JournalEntry } from "../../../src/core/journal/store.types.js";
import type { Finding, RuleContext } from "../../../src/core/rules/rule.types.js";
import { evaluate } from "../../../src/core/rules/evaluate.js";
import { needsYou, worst } from "../../../src/core/rules/needs-you.js";
import { RULES } from "../../../src/core/rules/registry.js";
import type { Level } from "../../../src/core/stacks/stacks.types.js";

const DAY = 86_400_000;
const NOW = 100 * DAY;

function wt(path: string, over: Partial<WorktreeFacts> = {}): WorktreeFacts {
  return {
    path,
    gitDir: `${path}/.git`,
    head: "a".repeat(40),
    branch: "main",
    isMain: false,
    locked: false,
    prunable: false,
    operation: null,
    operationBranch: null,
    changes: null,
    touchedAt: NOW,
    ...over,
  };
}

function level(over: Partial<Level> = {}): Level {
  return {
    branch: "f/two",
    parent: "f/one",
    depth: 1,
    worktree: null,
    parentCommitsSinceFork: 0,
    behindTrunk: 0,
    parentMerged: false,
    parentMissing: false,
    ...over,
  };
}

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    branch: "feat",
    oldTip: "a".repeat(40),
    newTip: "b".repeat(40),
    kind: "rewritten",
    lost: ["c1", "c2"],
    matchedByPatch: 0,
    matchedByMeta: 0,
    pinRef: "refs/grove/pins/feat/1",
    at: NOW,
    foundLater: false,
    acked: false,
    ...over,
  };
}

function ctx(over: { worktrees?: WorktreeFacts[]; levels?: Level[] } & Partial<RuleContext> = {}): RuleContext {
  const { worktrees = [], levels = [], ...rest } = over;
  const facts: RepoFacts = {
    root: "/r",
    commonDir: "/r/.git",
    trunk: { name: "main", ref: "refs/heads/main", sha: "a".repeat(40) },
    lastFetchAt: null,
    worktrees,
    branches: [],
    edges: [],
    stashes: [],
    pins: [],
    readAt: NOW,
  };
  return {
    facts,
    features: levels.length > 0 ? [{ name: "f", kind: "stack", levels }] : [],
    unresolved: [],
    removals: new Map(),
    envMissing: new Map(),
    detachedOnly: new Map(),
    now: NOW,
    ...rest,
  };
}

function run(id: string, c: RuleContext): Finding[] {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  return rule.evaluate(c);
}

test("history-rewritten fires on rewritten entries only", () => {
  const hit = run("history-rewritten", ctx({ unresolved: [entry(), entry({ kind: "deleted", newTip: null })] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({
    severity: "loses-work",
    subject: { kind: "branch", id: "feat" },
    action: "git grove restore feat refs/grove/pins/feat/1",
  });
  expect(hit[0]?.detail).toContain("2");
  expect(hit[0]?.detail).toContain("refs/grove/pins/feat/1");
  expect(hit[0]?.detail).toContain("git grove ack feat");
  expect(run("history-rewritten", ctx({ unresolved: [entry({ kind: "advanced" })] }))).toEqual([]);
});

test("branch-deleted fires on deleted entries only", () => {
  const hit = run("branch-deleted", ctx({ unresolved: [entry({ kind: "deleted", newTip: null })] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({ severity: "loses-work", action: "git grove restore feat refs/grove/pins/feat/1" });
  expect(hit[0]?.detail).toContain("git grove ack feat");
  expect(run("branch-deleted", ctx({ unresolved: [entry()] }))).toEqual([]);
});

test("alert details count commits in plain English", () => {
  const one = { lost: ["c1"] };
  expect(run("history-rewritten", ctx({ unresolved: [entry()] }))[0]?.detail).toMatch(/^2 commits no longer on feat, /);
  expect(run("history-rewritten", ctx({ unresolved: [entry(one)] }))[0]?.detail).toMatch(/^1 commit no longer on feat, /);
  const deleted = entry({ ...one, kind: "deleted", newTip: null });
  expect(run("branch-deleted", ctx({ unresolved: [deleted] }))[0]?.detail).toMatch(/^1 commit only on feat, /);
  const moved = run("parent-moved", ctx({ levels: [level({ parentCommitsSinceFork: 1 })] }));
  expect(moved[0]?.detail).toBe("f/one has 1 commit not in f/two");
});

test("env-missing says a single file exists and several exist", () => {
  const hit = run("env-missing", ctx({ envMissing: new Map([["/r/a", [".env"]], ["/r/b", [".env", ".env.local"]]]) }));
  expect(hit.map((finding) => finding.detail)).toEqual([
    ".env exists in the main worktree but not in /r/a",
    ".env, .env.local exist in the main worktree but not in /r/b",
  ]);
});

test("unsafe-merged-worktree fires for a removal verdict that is not ok", () => {
  const bad = new Map([
    ["/r/w", { ok: false, reasons: [{ code: "uncommitted" as const, detail: "2 uncommitted files", paths: [] }] }],
  ]);
  const hit = run("unsafe-merged-worktree", ctx({ removals: bad }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({
    severity: "loses-work",
    subject: { kind: "worktree", id: "/r/w" },
    action: "git grove check remove /r/w",
  });
  expect(hit[0]?.detail).toContain("2 uncommitted files");
  expect(run("unsafe-merged-worktree", ctx({ removals: new Map([["/r/w", { ok: true, reasons: [] }]]) }))).toEqual([]);
});

test("nested-worktree fires on the outer worktree, not on siblings with a shared prefix", () => {
  const hit = run("nested-worktree", ctx({ worktrees: [wt("/r/a"), wt("/r/a/inner")] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({
    severity: "needs-action",
    subject: { kind: "worktree", id: "/r/a" },
    action: "move the inner worktree out with git worktree move",
  });
  expect(run("nested-worktree", ctx({ worktrees: [wt("/r/a"), wt("/r/ab")] }))).toEqual([]);
});

test("nested-worktree ignores the main worktree as outer but fires for linked inside linked", () => {
  expect(
    run("nested-worktree", ctx({ worktrees: [wt("/r", { isMain: true }), wt("/r/.worktrees/x")] })),
  ).toEqual([]);
  const hit = run("nested-worktree", ctx({ worktrees: [wt("/r", { isMain: true }), wt("/r/a"), wt("/r/a/.worktrees/b")] }));
  expect(hit.map((f) => f.subject.id)).toEqual(["/r/a"]);
});

test("a prunable worktree untouched for 20 days yields prunable only", () => {
  const out = evaluate(ctx({ worktrees: [wt("/r/a", { prunable: true, touchedAt: NOW - 20 * DAY })] }));
  expect(out.map((f) => f.rule)).toEqual(["prunable"]);
});

test("operation-in-progress fires when an operation is underway", () => {
  const hit = run("operation-in-progress", ctx({ worktrees: [wt("/r/a", { operation: "rebase" })] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({ severity: "needs-action", action: "finish or abort the rebase in /r/a" });
  expect(run("operation-in-progress", ctx({ worktrees: [wt("/r/a")] }))).toEqual([]);
});

test("parent-merged fires on parentMerged and on parentMissing", () => {
  const merged = run("parent-merged", ctx({ levels: [level({ parentMerged: true })] }));
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    severity: "needs-action",
    title: "Parent merged",
    subject: { kind: "level", id: "f/f/two" },
    action: "re-base onto main",
  });
  const gone = run("parent-merged", ctx({ levels: [level({ parentMissing: true })] }));
  expect(gone[0]?.title).toBe("Parent gone");
  expect(run("parent-merged", ctx({ levels: [level()] }))).toEqual([]);
});

test("parent-moved fires when the parent has new commits and is neither merged nor missing", () => {
  const hit = run("parent-moved", ctx({ levels: [level({ parentCommitsSinceFork: 3 })] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({ severity: "needs-action", action: "restack f/two onto f/one" });
  expect(run("parent-moved", ctx({ levels: [level({ parentCommitsSinceFork: 3, parentMerged: true })] }))).toEqual([]);
  expect(run("parent-moved", ctx({ levels: [level({ parentCommitsSinceFork: 3, parentMissing: true })] }))).toEqual([]);
  expect(run("parent-moved", ctx({ levels: [level()] }))).toEqual([]);
});

test("env-missing fires for a non-empty list only", () => {
  const hit = run("env-missing", ctx({ envMissing: new Map([["/r/a", [".env", ".env.local"]], ["/r/b", []]]) }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({
    severity: "needs-action",
    subject: { kind: "worktree", id: "/r/a" },
    action: "copy .env, .env.local from the main worktree",
  });
});

test("prunable fires on a prunable worktree", () => {
  const hit = run("prunable", ctx({ worktrees: [wt("/r/a", { prunable: true }), wt("/r/b")] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({ severity: "needs-action", action: "git worktree prune" });
});

test("prunable on a detached worktree holding commits only on its HEAD is loses-work with a rescue branch", () => {
  const head = "d".repeat(40);
  const sandbox = wt("/r/.worktrees/sandbox", { prunable: true, branch: null, head });
  const hit = run("prunable", ctx({ worktrees: [sandbox], detachedOnly: new Map([[sandbox.path, 2]]) }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({ severity: "loses-work", action: `git branch rescue/sandbox ${head}` });
  expect(hit[0]?.detail).toContain("2 commits only on its detached HEAD");
  const empty = run("prunable", ctx({ worktrees: [sandbox], detachedOnly: new Map([[sandbox.path, 0]]) }));
  expect(empty[0]).toMatchObject({ severity: "needs-action", action: "git worktree prune" });
});

test("prunable on a detached worktree whose commits could not be counted is loses-work with a rescue branch", () => {
  const head = "d".repeat(40);
  const sandbox = wt("/r/.worktrees/sandbox", { prunable: true, branch: null, head });
  const hit = run("prunable", ctx({ worktrees: [sandbox], detachedOnly: new Map([[sandbox.path, null]]) }));
  expect(hit).toEqual([
    expect.objectContaining({
      severity: "loses-work",
      detail: "/r/.worktrees/sandbox no longer exists on disk; could not check commits on its detached HEAD",
      action: `git branch rescue/sandbox ${head}`,
    }),
  ]);
});

test("idle fires on a non-main worktree untouched for more than 14 days", () => {
  const old = NOW - 15 * DAY;
  const hit = run("idle", ctx({ worktrees: [wt("/r/a", { touchedAt: old })] }));
  expect(hit).toHaveLength(1);
  expect(hit[0]).toMatchObject({ severity: "idle", action: null });
  expect(run("idle", ctx({ worktrees: [wt("/r/a", { touchedAt: NOW - 14 * DAY })] }))).toEqual([]);
  expect(run("idle", ctx({ worktrees: [wt("/r/a", { touchedAt: old, isMain: true })] }))).toEqual([]);
  expect(run("idle", ctx({ worktrees: [wt("/r/a", { touchedAt: null })] }))).toEqual([]);
});

test("evaluate orders findings by severity, rule, then subject, deterministically", () => {
  const c = ctx({
    worktrees: [wt("/r/z", { operation: "merge" }), wt("/r/a", { operation: "merge" }), wt("/r/i", { touchedAt: 0 })],
    unresolved: [entry()],
  });
  const out = evaluate(c);
  expect(out.map((f) => `${f.rule}:${f.subject.id}`)).toEqual([
    "history-rewritten:feat",
    "operation-in-progress:/r/a",
    "operation-in-progress:/r/z",
    "idle:/r/i",
  ]);
  expect(evaluate(c)).toEqual(out);
});

test("needsYou keeps needs-action or worse, worst first, stable", () => {
  const f = (rule: string, severity: Finding["severity"]): Finding => ({
    rule,
    severity,
    subject: { kind: "branch", id: rule },
    title: "",
    detail: "",
    action: null,
  });
  const out = needsYou([
    f("a", "idle"),
    f("b", "needs-action"),
    f("c", "loses-work"),
    f("d", "waiting-on-review"),
    f("e", "needs-action"),
  ]);
  expect(out.map((x) => x.rule)).toEqual(["c", "b", "e"]);
});

test("worst of nothing is fine, otherwise the highest severity", () => {
  expect(worst([])).toBe("fine");
  const g = (severity: Finding["severity"]): Finding => ({
    rule: "r",
    severity,
    subject: { kind: "branch", id: "x" },
    title: "",
    detail: "",
    action: null,
  });
  expect(worst([g("idle"), g("needs-action")])).toBe("needs-action");
});
