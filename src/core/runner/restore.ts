import type { Sha } from "../facts/facts.types.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { runGit } from "../git/run-git.js";
import { listPins } from "./list-pins.js";
import { pin } from "./pin.js";
import { RefusedError } from "./refused.error.js";
import { withRepoLock } from "./with-repo-lock.js";

async function revParse(cwd: string, rev: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Moves `branch` back to a pin (default: its newest), after pinning its current tip.
 * Refuses when the worktree holding the branch has uncommitted changes or an operation in progress.
 */
export async function restore(
  cwd: string,
  branch: string,
  pinRef?: string,
): Promise<{ from: Sha; to: Sha; pinnedCurrent: string }> {
  const facts = await readRepoFacts(cwd);
  return withRepoLock(facts.commonDir, async () => {
    const target = pinRef ?? (await listPins(facts.root, branch))[0]?.ref;
    if (target === undefined) throw new RefusedError(`git-grove: no pin found for ${branch}`);
    const to = await revParse(facts.root, target);
    if (to === null) throw new RefusedError(`git-grove: cannot resolve ${target}`);
    const from = await revParse(facts.root, `refs/heads/${branch}`);
    if (from === null) throw new RefusedError(`git-grove: no branch named ${branch}`);

    const holder = facts.worktrees.find((worktree) => worktree.branch === branch);
    if (holder?.operation) throw new RefusedError(`git-grove: ${branch} is mid-${holder.operation} in ${holder.path}`);
    const changes = holder?.changes;
    if (changes && changes.staged + changes.unstaged + changes.untracked > 0) {
      throw new RefusedError(`git-grove: ${holder.path} has uncommitted changes`);
    }

    const pinnedCurrent = await pin(facts.root, branch, from, new Date());
    if (holder) await runGit(["reset", "--keep", to], { cwd: holder.path, write: true });
    else await runGit(["update-ref", `refs/heads/${branch}`, to, from], { cwd: facts.root, write: true });
    return { from, to, pinnedCurrent };
  });
}
