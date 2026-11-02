import { shellWord } from "../actions/shell-word.js";
import { listPaths } from "../actions/list-paths.js";
import type { Reason, ReasonCode, Verdict } from "../rules/verdict.types.js";
import { shownPath } from "./shown-path.js";

/** A worktree a command would delete, and its verdict when that is not safe. */
export type UnsafeWorktree = { path: string; verdict: Verdict };

const SHOWN = 3;

const HINTS: Partial<Record<ReasonCode, string>> = {
  uncommitted: "commit or stash its changes",
  untracked: "commit or stash its changes",
  unpushed: "push its commits",
  "detached-only": "put its commits on a branch",
  "nested-worktree": "move the worktrees inside it out with git worktree move",
  "nested-repo": "move the repositories inside it out",
};

function clauses(from: string, reasons: readonly Reason[]): string {
  const held: string[] = [];
  const other: string[] = [];
  for (const reason of reasons) {
    const paths = reason.code === "nested-worktree" ? reason.paths.map((path) => shownPath(from, path)) : reason.paths;
    if (reason.code === "main-worktree") other.push("it is the main worktree");
    else if (reason.code === "unreadable") other.push(`git grove ${reason.detail}`);
    else if (reason.code === "too-many-ignored") other.push("it holds too many ignored files to check");
    else held.push(paths.length > 0 ? `${reason.detail} (${listPaths(paths)})` : reason.detail);
  }
  return [...(held.length > 0 ? [`it holds ${held.join("; ")}`] : []), ...other].join("; ");
}

function onlyPrecious(worktree: UnsafeWorktree): boolean {
  return worktree.verdict.reasons.every((reason) => reason.code === "precious-ignored");
}

function rescue(from: string, worktree: UnsafeWorktree): string {
  return `git grove rm --rescue ${shellWord(shownPath(from, worktree.path))}`;
}

function advice(from: string, worktree: UnsafeWorktree): string {
  if (onlyPrecious(worktree)) return `Run: ${rescue(from, worktree)}`;
  const { reasons } = worktree.verdict;
  const hints = [...new Set(reasons.flatMap((reason) => HINTS[reason.code] ?? []))];
  if (hints.length === 0) return "Leave it in place and tell the user.";
  const then = reasons.some((reason) => reason.code === "precious-ignored") ? `, then run ${rescue(from, worktree)}` : "";
  return `To remove it, first ${hints.join(" and ")}${then}; or leave it and tell the user.`;
}

/**
 * The message for a command that would delete `target` and with it the worktrees in `unsafe`, or the main worktree
 * `main`: what each holds that would be lost and the safe alternative, in a few lines, with paths as seen from `from`.
 */
export function removalBlockMessage(from: string, target: string, unsafe: readonly UnsafeWorktree[], main: string | null): string {
  const shownTarget = shownPath(from, target);
  if (main !== null) {
    return `git grove blocked: ${shownTarget} holds the main worktree ${shownPath(from, main)}, and with it the repository. Leave it in place.`;
  }
  const [first] = unsafe;
  if (first !== undefined && unsafe.length === 1 && first.path === target) {
    return `git grove blocked: ${shownTarget} is not safe to remove: ${clauses(from, first.verdict.reasons)}.\n${advice(from, first)}`;
  }
  const count = unsafe.length === 1 ? "a worktree that is" : `${unsafe.length} worktrees that are`;
  const lines = unsafe.slice(0, SHOWN).map((worktree) => `  ${shownPath(from, worktree.path)}: ${clauses(from, worktree.verdict.reasons)}`);
  if (unsafe.length > SHOWN) lines.push(`  and ${unsafe.length - SHOWN} more`);
  const next = unsafe.every(onlyPrecious)
    ? `Run first: ${unsafe.map((worktree) => rescue(from, worktree)).join("; ")}`
    : "Remove worktrees one at a time with git grove rm, which refuses what would lose work, or leave them and tell the user.";
  return [`git grove blocked: ${shownTarget} holds ${count} not safe to remove:`, ...lines, next].join("\n");
}
