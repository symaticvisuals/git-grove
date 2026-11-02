import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(ROOT, "dist", "cli", "bin.js");

type Spawned = { code: number | null; stdout: string; stderr: string };

let home: string;
let repo: TestRepo;
let root: string;

function hookJson(command: string, cwd: string): string {
  return JSON.stringify({ session_id: "s-1", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
}

/** Runs the built bin with `stdin` piped in, as Claude Code runs a hook. */
function runBin(args: string[], stdin: string, cwd: string): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, GIT_GROVE_HOME: home, HOME: home } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  repo = await makeRepo();
  root = await realpath(repo.path);
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  await repo.commit("base.txt", "base\n", "base");
  const path = join(root, ".worktrees", "old-onboarding");
  await repo.worktree(path, "old-onboarding");
  await mkdir(join(path, ".local"), { recursive: true });
  await writeFile(join(path, ".local", "seed.sql"), "insert;\n");
}, 60_000);
afterAll(async () => {
  await repo.cleanup();
  await rm(home, { recursive: true, force: true });
});

test("guard --claude exits 2 with the reason on stderr for a worktree removal that loses work", async () => {
  const result = await runBin(["guard", "--claude"], hookJson("git worktree remove --force .worktrees/old-onboarding", root), root);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "git grove blocked: .worktrees/old-onboarding is not safe to remove: it holds 1 ignored file that exists only here (.local/seed.sql).\n" +
      "Run: git grove rm --rescue .worktrees/old-onboarding\n",
  );
});

test("guard --claude exits 0 with empty stdout for a command it allows", async () => {
  expect(await runBin(["guard", "--claude"], hookJson("ls -la && git status", root), root)).toEqual({ code: 0, stdout: "", stderr: "" });
});

test("guard --claude exits 0 with one warning line for stdin it cannot read", async () => {
  expect(await runBin(["guard", "--claude"], "{", root)).toEqual({
    code: 0,
    stdout: "",
    stderr: "git-grove guard: could not check (stdin is not a hook's JSON); allowing\n",
  });
});

test("a broken install, bin.js with none of its modules, still allows from the hook with one warning", async () => {
  const lone = await mkdtemp(join(tmpdir(), "git-grove-lone-bin-"));
  try {
    await copyFile(BIN, join(lone, "bin.js"));
    await writeFile(join(lone, "package.json"), '{"type":"module"}\n');
    const result = await new Promise<Spawned>((resolve, reject) => {
      const child = spawn(process.execPath, [join(lone, "bin.js"), "guard", "--claude"], { cwd: root, env: { ...process.env, HOME: home } });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(hookJson("git worktree remove --force .worktrees/old-onboarding", root));
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^git-grove guard: could not check \([^\n]+\); allowing\n$/);
  } finally {
    await rm(lone, { recursive: true, force: true });
  }
});

test("guard without --claude prints its usage and exits 1", async () => {
  const result = await runBin(["guard"], "", root);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Usage: git grove guard --claude");
});
