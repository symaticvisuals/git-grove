import { findWorktree } from "../../facts/find-worktree.js";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { verdictFor } from "../../facts/verdict-for.js";
import { branchLanded } from "../../stacks/branch-landed.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { InvalidInputError } from "../invalid-input.error.js";
import { readRemoval } from "./read-removal.js";
import { removePlan, type RemoveRead } from "./remove-plan.js";
import { runRemove } from "./run-remove.js";

const SHAPE = "remove takes { worktree, rescue? }";

function parseInput(raw: unknown): { worktree: string; rescue: boolean } {
  if (typeof raw !== "object" || raw === null || !("worktree" in raw)) throw new InvalidInputError(SHAPE);
  const { worktree } = raw;
  const rescue = "rescue" in raw ? raw.rescue : undefined;
  if (typeof worktree !== "string" || worktree === "") throw new InvalidInputError(SHAPE);
  if (rescue !== undefined && typeof rescue !== "boolean") throw new InvalidInputError(SHAPE);
  return { worktree, rescue: rescue === true };
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const input = parseInput(raw);
  const facts = await readRepoFacts(ctx.root);
  const worktree = await findWorktree(facts, ctx.root, input.worktree);
  const verdict = worktree.isMain ? null : await verdictFor(facts, worktree.path);
  const branch = facts.branches.find((candidate) => candidate.name === worktree.branch);
  const read: RemoveRead = {
    removal: await readRemoval(facts, worktree, verdict),
    rescue: input.rescue,
    landed: branch !== undefined && !worktree.isMain && (await branchLanded(facts.root, branch, facts.trunk.ref)),
  };
  return { plan: removePlan(facts, read), execute: (run) => runRemove(read, run) };
}

/**
 * Removes one linked worktree's folder: `{ worktree, rescue? }`, where `worktree` is a path, relative to the main
 * worktree or absolute. Blocked whenever its safe-to-remove verdict gives a reason, and for the main, a locked or a
 * prunable worktree or one mid-operation. With `rescue`, precious ignored files do not block: each is copied into main
 * (never overwriting) and checked byte for byte first. The verdict is re-read right before the folder goes; the
 * branch is always kept. An ignored file written between that last re-check and the removal is not protected.
 */
export const removeAction: ActionDef = { name: "remove", prepare };
