import { realpath } from "node:fs/promises";
import { findWorktree } from "../facts/find-worktree.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { removalVerdict } from "../facts/removal-verdict.js";
import type { GuardCheck } from "./guard-check.types.js";
import type { GuardBlock } from "./guard-decision.types.js";
import { removalBlockMessage } from "./removal-block-message.js";

/**
 * Blocks `git worktree remove` of a worktree that is not safe to remove, with the same verdict as
 * `git grove check remove`; resolves to null when it is safe. Throws NotAWorktreeError for a target that is no worktree.
 */
export async function judgeWorktreeRemove(check: GuardCheck & { kind: "worktree-remove" }, from: string): Promise<GuardBlock | null> {
  const facts = await readRepoFacts(check.cwd);
  const worktree = await findWorktree(facts, check.cwd, check.target);
  const verdict = await removalVerdict(facts, worktree);
  if (verdict.ok) return null;
  return {
    message: removalBlockMessage({ from, root: await realpath(facts.root).catch(() => facts.root) }, worktree.path, [{ path: worktree.path, verdict }], null),
    verb: check.verb,
    subject: { commonDir: facts.commonDir, root: facts.root, worktree: worktree.path, branch: worktree.branch },
  };
}
