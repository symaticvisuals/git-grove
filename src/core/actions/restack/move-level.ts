import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Sha } from "../../facts/facts.types.js";
import { runGit } from "../../git/run-git.js";
import { errorLine } from "../error-line.js";
import { readDirtyPaths } from "../read-dirty-paths.js";

/** `parent` is recorded as the branch's new `stackparent`, with `feature` as its `grovefeature`, or null to keep both. */
export type LevelMove = {
  worktree: string;
  branch: string;
  fork: Sha;
  onto: Sha;
  parent: string | null;
  feature: string;
  setAside: boolean;
  stashMessage: string;
};

/**
 * What happened to a change set aside: nothing was, it is back, or it is still in the stash as `stash`, either because
 * it did not apply (leaving `touched` paths changed, `conflicted` ones in conflict) or because a rebase is still in progress.
 */
export type PutBack =
  | { state: "none" }
  | { state: "back" }
  | { state: "kept"; stash: Sha; why: "did-not-apply" | "rebase-in-progress"; touched: string[]; conflicted: string[] };

/** `unrecorded` says why the new fork point, parent or feature was not written; `rebaseLeft` that a rebase is still in progress. */
export type LevelMoveResult =
  | { kind: "moved"; tip: Sha; unrecorded: string | null; putBack: PutBack }
  | { kind: "conflict"; paths: string[]; putBack: PutBack; rebaseLeft: boolean }
  | { kind: "failed"; reason: string; putBack: PutBack; rebaseLeft: boolean };

type Attempt = { kind: "moved"; tip: Sha } | { kind: "conflict"; paths: string[] } | { kind: "failed"; reason: string };

const NONE: PutBack = { state: "none" };

function firstLine(stderr: string): string | null {
  const lines = stderr.split("\n").map((line) => line.trim());
  return lines.find((line) => /^(?:error|fatal):/.test(line)) ?? lines.find((line) => line !== "") ?? null;
}

async function stashTop(worktree: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", "refs/stash"], { cwd: worktree, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function conflictedPaths(worktree: string): Promise<string[]> {
  try {
    const result = await runGit(["diff", "--name-only", "-z", "--diff-filter=U"], { cwd: worktree, allowFailure: true });
    return result.code === 0 ? result.stdout.split("\0").filter((path) => path !== "") : [];
  } catch {
    return [];
  }
}

async function setAside(worktree: string, message: string): Promise<{ stash: Sha | null; error: string | null }> {
  const before = await stashTop(worktree);
  let error: string | null = null;
  try {
    const pushed = await runGit(["stash", "push", "--include-untracked", "-m", message], {
      cwd: worktree,
      write: true,
      allowFailure: true,
    });
    if (pushed.code !== 0) error = firstLine(pushed.stderr) ?? `git stash push exited with ${pushed.code}`;
  } catch (caught) {
    error = errorLine(caught);
  }
  const after = await stashTop(worktree).catch(() => null);
  const stash = after !== null && after !== before ? after : null;
  return { stash, error: error ?? (stash === null ? "git stash push set nothing aside" : null) };
}

async function stashEntry(worktree: string, stash: Sha): Promise<string | null> {
  const { stdout } = await runGit(["stash", "list", "--format=%H"], { cwd: worktree });
  const index = stdout.split("\n").indexOf(stash);
  return index === -1 ? null : `stash@{${index}}`;
}

async function putBack(worktree: string, stash: Sha): Promise<PutBack> {
  const kept = async (): Promise<PutBack> => ({
    state: "kept",
    stash,
    why: "did-not-apply",
    touched: await readDirtyPaths(worktree).catch(() => []),
    conflicted: await conflictedPaths(worktree),
  });
  try {
    for (const flags of [["--index"], []]) {
      const entry = await stashEntry(worktree, stash);
      if (entry === null) return await kept();
      const popped = await runGit(["stash", "pop", ...flags, entry], { cwd: worktree, write: true, allowFailure: true });
      if (popped.code === 0) return { state: "back" };
      if ((await readDirtyPaths(worktree)).length > 0) return await kept();
    }
    return await kept();
  } catch {
    return kept();
  }
}

async function rebaseInProgress(worktree: string): Promise<boolean> {
  try {
    const result = await runGit(["rev-parse", "--absolute-git-dir"], { cwd: worktree, allowFailure: true });
    if (result.code !== 0) return false;
    const gitDir = result.stdout.trim();
    return existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"));
  } catch {
    return true;
  }
}

async function rebase(level: LevelMove): Promise<Attempt> {
  const { worktree, branch } = level;
  const args = ["rebase", "--no-update-refs", "--no-autosquash", "--onto", level.onto, level.fork, branch];
  const result = await runGit(args, { cwd: worktree, write: true, allowFailure: true, env: { GIT_EDITOR: "true" } });
  if (result.code === 0) {
    return { kind: "moved", tip: (await runGit(["rev-parse", `refs/heads/${branch}`], { cwd: worktree })).stdout.trim() };
  }
  const paths = await conflictedPaths(worktree);
  if (paths.length > 0) return { kind: "conflict", paths };
  return { kind: "failed", reason: firstLine(result.stderr) ?? `git rebase exited with ${result.code}` };
}

async function record(level: LevelMove): Promise<string | null> {
  try {
    const options = { cwd: level.worktree, write: true };
    await runGit(["config", `branch.${level.branch}.stackforkpoint`, level.onto], options);
    if (level.parent !== null) {
      await runGit(["config", `branch.${level.branch}.stackparent`, level.parent], options);
      await runGit(["config", `branch.${level.branch}.grovefeature`, level.feature], options);
    }
    return null;
  } catch (error) {
    return errorLine(error);
  }
}

/**
 * Moves one level onto `onto` in its own worktree: sets its uncommitted changes aside when `setAside` allows it,
 * replays `fork..branch` with `git rebase --no-update-refs --no-autosquash --onto`, records the new fork point (and
 * parent and feature), then puts the changes back. A rebase that stops is aborted before the changes go back, so the
 * branch and its files are where they were; a change is never put back while a rebase is in progress. Once anything is
 * set aside it never throws. Never pushes, and moves no branch but `branch`.
 */
export async function moveLevel(level: LevelMove): Promise<LevelMoveResult> {
  const { worktree } = level;
  const dirty = await readDirtyPaths(worktree);
  if (dirty.length > 0 && !level.setAside) {
    return { kind: "failed", reason: "it has uncommitted changes", putBack: NONE, rebaseLeft: false };
  }
  const aside = dirty.length > 0 ? await setAside(worktree, level.stashMessage) : { stash: null, error: null };
  if (aside.error !== null) {
    const back = aside.stash === null ? NONE : await putBack(worktree, aside.stash);
    return { kind: "failed", reason: `could not set its changes aside: ${aside.error}`, putBack: back, rebaseLeft: false };
  }

  const attempt = await rebase(level).catch((error: unknown): Attempt => ({ kind: "failed", reason: errorLine(error) }));
  let rebaseLeft = false;
  if (attempt.kind !== "moved" && (await rebaseInProgress(worktree))) {
    await runGit(["rebase", "--abort"], { cwd: worktree, write: true, allowFailure: true }).catch(() => null);
    rebaseLeft = await rebaseInProgress(worktree);
  }
  const unrecorded = attempt.kind === "moved" ? await record(level) : null;
  let back: PutBack = NONE;
  if (aside.stash !== null) {
    back = rebaseLeft
      ? { state: "kept", stash: aside.stash, why: "rebase-in-progress", touched: [], conflicted: [] }
      : await putBack(worktree, aside.stash);
  }

  if (attempt.kind === "moved") return { kind: "moved", tip: attempt.tip, unrecorded, putBack: back };
  if (attempt.kind === "conflict") return { kind: "conflict", paths: attempt.paths, putBack: back, rebaseLeft };
  return { kind: "failed", reason: attempt.reason, putBack: back, rebaseLeft };
}
