import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type GuardDeps, guardCommand } from "../../src/cli/commands/guard.js";
import { recordGuardActivity } from "../../src/cli/record-guard-activity.js";
import { evaluateCommandLine, type GuardInput } from "../../src/core/guard/evaluate-command-line.js";
import { openStore } from "../../src/core/journal/open-store.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
const SESSION = "0d7c5a2e-5b1f-4c11-9a43-2f0c3c1e9b77";
let home: string;
let repo: TestRepo;
let root: string;

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
  root = await realpath(repo.path);
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  await repo.commit("base.txt", "base\n", "base");
});
afterEach(() => repo.cleanup());

const REAL: GuardDeps = { evaluate: evaluateCommandLine, record: recordGuardActivity, home: "/home/robin", deadlineMs: 3000 };

function hookJson(command: string, cwd: string = root, toolName = "Bash"): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: "/home/robin/.claude/projects/x/session.jsonl",
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { command, description: "a command" },
    tool_use_id: "toolu_01",
  });
}

async function guard(stdin: string, deps: Partial<GuardDeps> = {}, cwd: string = root): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await guardCommand({ out: (s) => out.push(s), err: (s) => err.push(s), cwd }, stdin, { ...REAL, ...deps });
  return { code, out: out.join(""), err: err.join("") };
}

async function preciousWorktree(): Promise<void> {
  const path = join(root, ".worktrees", "x");
  await repo.worktree(path, "x");
  await mkdir(join(path, ".local"), { recursive: true });
  await writeFile(join(path, ".local", "seed.sql"), "insert;\n");
}

function activityOf(commonDir: string): { title: string; detail: string; branch: string | null; kind: string }[] {
  const store = openStore();
  try {
    const id = store.findRepoId(commonDir);
    return id === null ? [] : store.activity(id, 50).map(({ title, detail, branch, kind }) => ({ title, detail, branch, kind }));
  } finally {
    store.close();
  }
}

function register(): string {
  const commonDir = join(root, ".git");
  const store = openStore();
  try {
    store.repoId(commonDir, root);
  } finally {
    store.close();
  }
  return commonDir;
}

test("a block exits 2 with the reason on stderr and nothing on stdout", async () => {
  await preciousWorktree();
  const result = await guard(hookJson("git worktree remove --force .worktrees/x"));
  expect(result.code).toBe(2);
  expect(result.out).toBe("");
  expect(result.err).toContain("git grove blocked: .worktrees/x is not safe to remove");
  expect(result.err.endsWith("\n")).toBe(true);
});

test("an allowed command exits 0 with no output", async () => {
  expect(await guard(hookJson("git status && ls"))).toEqual({ code: 0, out: "", err: "" });
});

test("a tool other than Bash is allowed without a word", async () => {
  expect(await guard(hookJson("git worktree remove --force .worktrees/x", root, "Write"))).toEqual({ code: 0, out: "", err: "" });
  expect(await guard(JSON.stringify({ tool_name: "Bash", tool_input: {} }))).toEqual({ code: 0, out: "", err: "" });
});

test("garbage on stdin is allowed, with a warning", async () => {
  for (const stdin of ["not json", "", "[1, 2]", '{"tool_input": {"command": "ls"}}']) {
    expect(await guard(stdin), stdin).toEqual({ code: 0, out: "", err: "git-grove guard: could not check (stdin is not a hook's JSON); allowing\n" });
  }
});

test("a cwd that is not a repository is allowed: plain commands silently, git ones with a warning", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    expect(await guard(hookJson("ls && rm -rf build", outside))).toEqual({ code: 0, out: "", err: "" });
    const result = await guard(hookJson("git reset --hard", outside));
    expect(result.code).toBe(0);
    expect(result.err).toMatch(/^git-grove guard: could not check \(not inside a git repository \([^\n]+\)\); allowing\n$/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("an error thrown inside the evaluation is allowed, with a warning", async () => {
  const evaluate = (): Promise<never> => Promise.reject(new Error("boom\nsecond line"));
  expect(await guard(hookJson("git worktree remove x"), { evaluate })).toEqual({
    code: 0,
    out: "",
    err: "git-grove guard: could not check (boom); allowing\n",
  });
});

test("an evaluation past its deadline is allowed, with a warning", async () => {
  const evaluate = (): Promise<never> => new Promise(() => undefined);
  expect(await guard(hookJson("git worktree remove x"), { evaluate, deadlineMs: 50 })).toEqual({
    code: 0,
    out: "",
    err: "git-grove guard: could not check (took longer than 0.05 s); allowing\n",
  });
});

test("the deadline stops the git calls the evaluation still has running", async () => {
  let signal: AbortSignal | undefined;
  const evaluate = (input: GuardInput): Promise<never> => {
    signal = input.signal;
    return new Promise(() => undefined);
  };
  await guard(hookJson("git worktree remove x"), { evaluate, deadlineMs: 50 });
  expect(signal?.aborted).toBe(true);
});

test("a block reaches stderr before its activity is recorded", async () => {
  await preciousWorktree();
  const order: string[] = [];
  const record = async (): Promise<void> => {
    order.push("record");
  };
  const code = await guardCommand({ out: () => undefined, err: () => order.push("stderr"), cwd: root }, hookJson("git worktree remove x"), { ...REAL, record });
  expect(code).toBe(2);
  expect(order).toEqual(["stderr", "record"]);
});

test("a line the guard cannot read is allowed, with one line saying so", async () => {
  expect(await guard(hookJson("bash -c 'git reset --hard'"))).toEqual({
    code: 0,
    out: "",
    err: "git grove cannot check this command\n",
  });
});

test("a block is recorded as activity with the session, the worktree and the command", async () => {
  const commonDir = register();
  await preciousWorktree();
  await guard(hookJson("git worktree remove --force .worktrees/x"));
  expect(activityOf(commonDir)).toEqual([
    {
      kind: "action",
      branch: "x",
      title: "Guard blocked git worktree remove",
      detail: `.worktrees/x is not safe to remove: it holds 1 ignored file that exists only here (.local/seed.sql) · .worktrees/x · session ${SESSION} · $ git worktree remove --force .worktrees/x`,
    },
  ]);
});

test("a new pin is recorded as activity; a reused pin and a plain allow are not", async () => {
  const commonDir = register();
  await guard(hookJson("git status"));
  await guard(hookJson("git commit --amend --no-edit"));
  await guard(hookJson("git commit --amend --no-edit"));
  const rows = activityOf(commonDir);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "action", branch: "main", title: "Guard pinned main before git commit --amend" });
  expect(rows[0]?.detail).toMatch(new RegExp(`^refs/grove/pins/main/\\d{8}T\\d{6}Z · the main checkout · session ${SESSION} · \\$ git commit --amend --no-edit$`));
});

test("the command in activity is cut to 200 characters", async () => {
  const commonDir = register();
  await writeFile(join(root, "base.txt"), "edited\n");
  const long = `git reset --hard ${"x".repeat(300)}`;
  await guard(hookJson(long));
  const [row] = activityOf(commonDir);
  const command = row?.detail.split(" · $ ")[1] ?? "";
  expect(command).toHaveLength(200);
  expect(command.endsWith("…")).toBe(true);
});

test("a repository grove does not know gets no activity", async () => {
  await preciousWorktree();
  await guard(hookJson("git worktree remove --force .worktrees/x"));
  expect(activityOf(join(root, ".git"))).toEqual([]);
});
