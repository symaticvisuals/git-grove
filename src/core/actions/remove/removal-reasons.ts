import type { RepoFacts } from "../../facts/facts.types.js";
import { readRemovalFacts } from "../../facts/read-removal-facts.js";
import { GitError } from "../../git/git.error.js";
import { safeToRemove } from "../../rules/safe-to-remove.js";
import type { RemovalFacts } from "../../rules/verdict.types.js";
import { displayPath } from "../display-path.js";
import { describeReason } from "./describe-reason.js";
import { removalBlocker } from "./removal-blocker.js";

async function removalFacts(root: string, path: string, facts: RepoFacts): Promise<RemovalFacts | null> {
  try {
    return await readRemovalFacts(root, path, facts);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/**
 * Reads the full safe-to-remove verdict of the worktree at `path` against `facts`, which the caller has just read, and
 * resolves to every reason it must not be removed, one line each; empty when it is safe. The precious ignored files
 * named in `present` (worktree-relative) count as kept in main, so the caller checks their copies itself; any other
 * precious file, and every other reason, is reported. A worktree that is gone, main, locked, untracked by git or
 * mid-operation is never safe, nor is one git fails to read.
 */
export async function removalReasons(facts: RepoFacts, path: string, present: ReadonlySet<string>): Promise<string[]> {
  const worktree = facts.worktrees.find((candidate) => candidate.path === path);
  if (worktree === undefined) return [`${displayPath(facts.root, path)} is no longer a worktree`];
  const blocker = removalBlocker(worktree);
  if (blocker !== null) return [blocker];
  const removal = await removalFacts(facts.root, path, facts);
  if (removal === null) return ["could not read this worktree"];
  const verdict = safeToRemove({ ...removal, preciousIgnored: removal.preciousIgnored.filter((file) => !present.has(file)) });
  return verdict.reasons.map((reason) => describeReason(facts.root, reason));
}
