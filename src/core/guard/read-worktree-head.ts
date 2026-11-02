import { basename, dirname } from "node:path";
import type { Sha } from "../facts/facts.types.js";
import { NotARepoError } from "../facts/not-a-repo.error.js";
import { runGit } from "../git/run-git.js";

/** The worktree around a folder: its top folder, the repository's common git dir and main worktree, and its HEAD. */
export type WorktreeHead = { top: string; commonDir: string; root: string; branch: string | null; sha: Sha | null };

const HEADS = "refs/heads/";

function rootOf(commonDir: string): string {
  return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
}

/**
 * Reads the worktree holding `cwd` in one git call: `branch` is null on a detached HEAD, and `sha` and `branch` are
 * both null before the first commit. Throws NotARepoError outside a repository.
 */
export async function readWorktreeHead(cwd: string): Promise<WorktreeHead> {
  const where = ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"];
  const full = await runGit([...where, "HEAD", "--symbolic-full-name", "HEAD"], { cwd, allowFailure: true });
  if (full.code === 0) {
    const [top = "", commonDir = "", sha = "", ref = ""] = full.stdout.split("\n");
    return { top, commonDir, root: rootOf(commonDir), branch: ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null, sha };
  }
  const bare = await runGit(where, { cwd, allowFailure: true });
  if (bare.code !== 0) throw new NotARepoError(`git-grove: not inside a git repository (${cwd})`);
  const [top = "", commonDir = ""] = bare.stdout.split("\n");
  return { top, commonDir, root: rootOf(commonDir), branch: null, sha: null };
}
