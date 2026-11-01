import { findWorktree } from "../../core/facts/find-worktree.js";
import { readRemovalFacts } from "../../core/facts/read-removal-facts.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { safeToRemove } from "../../core/rules/safe-to-remove.js";
import type { Reason, Verdict } from "../../core/rules/verdict.types.js";
import type { CliIo } from "../cli-io.types.js";

const SAFE = 0;
const UNSAFE = 3;

const MAIN_WORKTREE: Verdict = {
  ok: false,
  reasons: [{ code: "main-worktree", detail: "the main worktree is never removed", paths: [] }],
};

function describe(reason: Reason): string {
  return reason.paths.length > 0 ? `${reason.detail}: ${reason.paths.join(", ")}` : reason.detail;
}

/**
 * Runs `git grove check remove <worktree> [--json]`: exits 0 when the worktree can be deleted without losing work
 * and 3 when it cannot, printing the reasons one per line (or the verdict as JSON). The main worktree is never safe.
 */
export async function checkCommand(io: CliIo, target: string, options: { json: boolean }): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const worktree = await findWorktree(facts, io.cwd, target);
  const verdict = worktree.isMain ? MAIN_WORKTREE : safeToRemove(await readRemovalFacts(facts.root, worktree.path, facts));
  if (options.json) io.out(`${JSON.stringify(verdict, null, 2)}\n`);
  else if (verdict.ok) io.out(`safe to remove ${worktree.path}\n`);
  else io.out(verdict.reasons.map((reason) => `${describe(reason)}\n`).join(""));
  return verdict.ok ? SAFE : UNSAFE;
}
