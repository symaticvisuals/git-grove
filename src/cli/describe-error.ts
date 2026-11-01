import { InvalidInputError } from "../core/actions/invalid-input.error.js";
import { BareRepoError } from "../core/facts/bare-repo.error.js";
import { NotARepoError } from "../core/facts/not-a-repo.error.js";
import { NotAWorktreeError } from "../core/facts/not-a-worktree.error.js";
import { GitError } from "../core/git/git.error.js";
import { GitVersionError } from "../core/git/git-version.error.js";
import { StoreCorruptError } from "../core/journal/store-corrupt.error.js";
import { StoreUnavailableError } from "../core/journal/store-unavailable.error.js";
import { RefusedError } from "../core/runner/refused.error.js";
import { RepoLockedError } from "../core/runner/repo-locked.error.js";

const ONE_LINE_ERRORS = [
  BareRepoError,
  NotARepoError,
  NotAWorktreeError,
  GitVersionError,
  InvalidInputError,
  RefusedError,
  RepoLockedError,
  StoreCorruptError,
  StoreUnavailableError,
];

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

function isSqliteError(error: unknown): error is Error {
  return error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR";
}

function isGitMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT" && "syscall" in error && error.syscall === "spawn git";
}

/**
 * Turns an error a person can act on into one line for stderr, or returns null for anything else (a bug).
 */
export function describeError(error: unknown): string | null {
  if (isGitMissing(error)) return "git-grove: git not found on PATH";
  if (error instanceof GitError) return `git-grove: ${firstLine(error.message)}`;
  if (isSqliteError(error)) return `git-grove: grove.db: ${firstLine(error.message)}`;
  if (error instanceof Error && ONE_LINE_ERRORS.some((kind) => error instanceof kind)) return firstLine(error.message);
  return null;
}
