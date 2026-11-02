import { InvalidInputError } from "./actions/invalid-input.error.js";
import { BareRepoError } from "./facts/bare-repo.error.js";
import { NotARepoError } from "./facts/not-a-repo.error.js";
import { NotAWorktreeError } from "./facts/not-a-worktree.error.js";
import { GitError } from "./git/git.error.js";
import { GitVersionError } from "./git/git-version.error.js";
import { StoreCorruptError } from "./journal/store-corrupt.error.js";
import { StoreUnavailableError } from "./journal/store-unavailable.error.js";
import { RefusedError } from "./runner/refused.error.js";
import { RepoLockedError } from "./runner/repo-locked.error.js";
import { ServiceFailedError } from "./service/service-failed.error.js";
import { ServiceUnsupportedError } from "./service/service-unsupported.error.js";
import { PortsInUseError } from "../server/http/ports-in-use.error.js";
import { ServerUnresponsiveError } from "../server/server-unresponsive.error.js";

const ONE_LINE_ERRORS = [
  BareRepoError,
  NotARepoError,
  NotAWorktreeError,
  GitVersionError,
  PortsInUseError,
  InvalidInputError,
  RefusedError,
  RepoLockedError,
  ServerUnresponsiveError,
  ServiceFailedError,
  ServiceUnsupportedError,
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
