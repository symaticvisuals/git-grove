import { GitError } from "../git/git.error.js";
import { safeToRemove } from "../rules/safe-to-remove.js";
import type { Verdict } from "../rules/verdict.types.js";
import type { RepoFacts } from "./facts.types.js";
import { readRemovalFacts } from "./read-removal-facts.js";

/**
 * The safe-to-remove verdict of the linked worktree at `path`. A git failure gives an `unreadable` verdict, never a
 * safe one. Throws MainWorktreeError for the main worktree and NotAWorktreeError for a path that is no worktree.
 */
export async function verdictFor(facts: RepoFacts, path: string): Promise<Verdict> {
  try {
    return safeToRemove(await readRemovalFacts(facts.root, path, facts));
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return { ok: false, reasons: [{ code: "unreadable", detail: "could not read this worktree", paths: [] }] };
  }
}
