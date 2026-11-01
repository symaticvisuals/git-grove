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

/** `moved`: an existing branch was reset to the pin; `created`: a branch that no longer existed was made at it. */
export type RestoreResult =
  | { kind: "moved"; from: Sha; to: Sha; pinnedCurrent: string; pinRef: string }
  | { kind: "created"; to: Sha; pinRef: string };

/**
 * Moves `branch` back to a pin (default: its newest), after pinning its current tip, or creates it at the pin
 * when the branch no longer exists. Takes the repo lock first and refuses if the branch tip changes before the move
 * (`beforeMove` is a test seam). Refuses when the worktree holding the branch has uncommitted changes
 * or an operation in progress, and when a worktree still has a deleted branch checked out.
 */
export async function restore(
  cwd: string,
  branch: string,
  pinRef?: string,
  beforeMove?: () => Promise<void>,
): Promise<RestoreResult> {
  const probe = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  return withRepoLock(probe.stdout.trim(), async () => {
    const facts = await readRepoFacts(cwd);
    const target = pinRef ?? (await listPins(facts.root, branch))[0]?.ref;
    if (target === undefined) throw new RefusedError(`git-grove: no pin found for ${branch}`);
    const to = await revParse(facts.root, target);
    if (to === null) throw new RefusedError(`git-grove: cannot resolve ${target}`);
    const from = await revParse(facts.root, `refs/heads/${branch}`);
    const holder = facts.worktrees.find((worktree) => worktree.branch === branch);
    if (from === null) {
      if (holder) throw new RefusedError(`git-grove: ${holder.path} has ${branch} checked out but the branch is gone`);
      await runGit(["update-ref", `refs/heads/${branch}`, to, ""], { cwd: facts.root, write: true });
      return { kind: "created", to, pinRef: target };
    }

    if (holder?.operation) throw new RefusedError(`git-grove: ${branch} is mid-${holder.operation} in ${holder.path}`);
    const changes = holder?.changes;
    if (changes && changes.staged + changes.unstaged + changes.untracked > 0) {
      throw new RefusedError(`git-grove: ${holder.path} has uncommitted changes`);
    }

    const pinnedCurrent = await pin(facts.root, branch, from, new Date());
    await beforeMove?.();
    if ((await revParse(facts.root, `refs/heads/${branch}`)) !== from) {
      throw new RefusedError(`git-grove: ${branch} moved while restoring; run again`);
    }
    if (holder) await runGit(["reset", "--keep", to], { cwd: holder.path, write: true });
    else await runGit(["update-ref", `refs/heads/${branch}`, to, from], { cwd: facts.root, write: true });
    return { kind: "moved", from, to, pinnedCurrent, pinRef: target };
  });
}
