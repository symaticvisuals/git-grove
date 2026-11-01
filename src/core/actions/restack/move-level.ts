import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Sha } from "../../facts/facts.types.js";
import { runGit } from "../../git/run-git.js";
import { errorLine } from "../error-line.js";
import { readDirtyPaths } from "../read-dirty-paths.js";

/** `parent` is recorded as the branch's new `stackparent`, or null to keep the one it has. */
export type LevelMove = {
  worktree: string;
  branch: string;
  fork: Sha;
  onto: Sha;
  parent: string | null;
  setAside: boolean;
  stashMessage: string;
};

/** What happened to a change set aside: nothing was, it is back, or it is still in the stash. */
export type PutBack = "none" | "back" | "kept";

/** `unrecorded` says why the new fork point or parent was not written; `rebaseLeft` that a rebase is still in progress. */
export type LevelMoveResult =
  | { kind: "moved"; tip: Sha; unrecorded: string | null; putBack: PutBack }
  | { kind: "conflict"; paths: string[]; putBack: PutBack; rebaseLeft: boolean }
  | { kind: "failed"; reason: string; putBack: PutBack; rebaseLeft: boolean };

type Attempt = { kind: "moved"; tip: Sha } | { kind: "conflict"; paths: string[] } | { kind: "failed"; reason: string };

function firstLine(stderr: string): string | null {
  const lines = stderr.split("\n").map((line) => line.trim());
  return lines.find((line) => /^(?:error|fatal):/.test(line)) ?? lines.find((line) => line !== "") ?? null;
}

async function stashTop(worktree: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", "refs/stash"], { cwd: worktree, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function setAside(worktree: string, message: string): Promise<{ stash: Sha | null; error: string | null }> {
  const before = await stashTop(worktree);
  const pushed = await runGit(["stash", "push", "--include-untracked", "-m", message], {
    cwd: worktree,
    write: true,
    allowFailure: true,
  });
  const after = await stashTop(worktree);
  const stash = after !== null && after !== before ? after : null;
  if (pushed.code === 0 && stash !== null) return { stash, error: null };
  return { stash, error: firstLine(pushed.stderr) ?? "git stash push set nothing aside" };
}

async function stashEntry(worktree: string, stash: Sha): Promise<string | null> {
  const { stdout } = await runGit(["stash", "list", "--format=%H"], { cwd: worktree });
  const index = stdout.split("\n").indexOf(stash);
  return index === -1 ? null : `stash@{${index}}`;
}

async function putBack(worktree: string, stash: Sha): Promise<PutBack> {
  try {
    for (const flags of [["--index"], []]) {
      const entry = await stashEntry(worktree, stash);
      if (entry === null) return "kept";
      const popped = await runGit(["stash", "pop", ...flags, entry], { cwd: worktree, write: true, allowFailure: true });
      if (popped.code === 0) return "back";
      if ((await readDirtyPaths(worktree)).length > 0) return "kept";
    }
    return "kept";
  } catch {
    return "kept";
  }
}

async function rebaseInProgress(worktree: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--absolute-git-dir"], { cwd: worktree, allowFailure: true });
  if (result.code !== 0) return false;
  const gitDir = result.stdout.trim();
  return existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"));
}

async function rebase(level: LevelMove): Promise<Attempt> {
  const { worktree, branch } = level;
  const args = ["rebase", "--no-update-refs", "--no-autosquash", "--onto", level.onto, level.fork, branch];
  const result = await runGit(args, { cwd: worktree, write: true, allowFailure: true, env: { GIT_EDITOR: "true" } });
  if (result.code === 0) {
    return { kind: "moved", tip: (await runGit(["rev-parse", `refs/heads/${branch}`], { cwd: worktree })).stdout.trim() };
  }
  const conflicted = await runGit(["diff", "--name-only", "-z", "--diff-filter=U"], { cwd: worktree, allowFailure: true });
  const paths = conflicted.code === 0 ? conflicted.stdout.split("\0").filter((path) => path !== "") : [];
  if (paths.length > 0) return { kind: "conflict", paths };
  return { kind: "failed", reason: firstLine(result.stderr) ?? `git rebase exited with ${result.code}` };
}

async function record(level: LevelMove): Promise<string | null> {
  try {
    const options = { cwd: level.worktree, write: true };
    await runGit(["config", `branch.${level.branch}.stackforkpoint`, level.onto], options);
    if (level.parent !== null) await runGit(["config", `branch.${level.branch}.stackparent`, level.parent], options);
    return null;
  } catch (error) {
    return errorLine(error);
  }
}

/**
 * Moves one level onto `onto` in its own worktree: sets its uncommitted changes aside when `setAside` allows it,
 * replays `fork..branch` with `git rebase --no-update-refs --no-autosquash --onto`, records the new fork point (and
 * parent), then puts the changes back. A rebase that stops is aborted before the changes go back, so the branch and its
 * files are where they were. Never pushes, and moves no branch but `branch`.
 */
export async function moveLevel(level: LevelMove): Promise<LevelMoveResult> {
  const { worktree } = level;
  const dirty = await readDirtyPaths(worktree);
  if (dirty.length > 0 && !level.setAside) {
    return { kind: "failed", reason: "it has uncommitted changes", putBack: "none", rebaseLeft: false };
  }
  const aside = dirty.length > 0 ? await setAside(worktree, level.stashMessage) : { stash: null, error: null };
  if (aside.error !== null) {
    const kept: PutBack = aside.stash === null ? "none" : await putBack(worktree, aside.stash);
    return { kind: "failed", reason: `could not set its changes aside: ${aside.error}`, putBack: kept, rebaseLeft: false };
  }

  const attempt = await rebase(level).catch((error: unknown): Attempt => ({ kind: "failed", reason: errorLine(error) }));
  let rebaseLeft = false;
  if (attempt.kind !== "moved" && (await rebaseInProgress(worktree))) {
    await runGit(["rebase", "--abort"], { cwd: worktree, write: true, allowFailure: true });
    rebaseLeft = await rebaseInProgress(worktree);
  }
  const unrecorded = attempt.kind === "moved" ? await record(level) : null;
  const back: PutBack = aside.stash === null ? "none" : rebaseLeft ? "kept" : await putBack(worktree, aside.stash);

  if (attempt.kind === "moved") return { kind: "moved", tip: attempt.tip, unrecorded, putBack: back };
  if (attempt.kind === "conflict") return { kind: "conflict", paths: attempt.paths, putBack: back, rebaseLeft };
  return { kind: "failed", reason: attempt.reason, putBack: back, rebaseLeft };
}
