import type { RepoFacts, Sha } from "../../facts/facts.types.js";
import { runGit } from "../../git/run-git.js";
import type { LastTip } from "../../journal/store.types.js";
import { forkOf } from "../../stacks/fork-of.js";
import type { Feature } from "../../stacks/stacks.types.js";
import type { ActionContext } from "../action.types.js";
import { busyIn } from "../busy-in.js";
import { holderIn } from "../holder-in.js";
import { readDirtyPaths } from "../read-dirty-paths.js";
import { orderRestack } from "./order-restack.js";
import { predictConflicts } from "./predict-conflicts.js";
import type { RestackLevel, RestackRead } from "./restack.types.js";
import { rewrittenLevels } from "./rewritten-levels.js";

async function countCommits(cwd: string, range: string): Promise<number> {
  return Number((await runGit(["rev-list", "--count", range], { cwd })).stdout.trim());
}

/**
 * Reads what restacking `feature` would do: each level that moves with its fork point, its new base and its worktree,
 * the levels left alone, and the conflicts git predicts for the first level that moves. A fork point the branch's
 * config does not give comes from the parent tip grove last saved for it, else the merge base.
 */
export async function readRestack(ctx: ActionContext, facts: RepoFacts, feature: Feature, stash: boolean): Promise<RestackRead> {
  const { root } = facts;
  const repoId = ctx.store.findRepoId(facts.commonDir);
  const hints = repoId === null ? new Map<string, LastTip>() : ctx.store.lastTips(repoId);
  const branches = new Map(facts.branches.map((branch) => [branch.name, branch]));
  const depths = new Map(feature.levels.map((level) => [level.branch, level.depth]));
  const numberOf = (branch: string): string => String(depths.get(branch) ?? 1).padStart(2, "0");
  const { moves, untouched } = orderRestack(feature, facts.trunk.name);

  const levels: RestackLevel[] = [];
  for (const move of moves) {
    const parentName = feature.levels.find((level) => level.branch === move.branch)?.parent ?? "";
    const branch = branches.get(move.branch);
    const parent = branches.get(parentName);
    if (branch === undefined || parent === undefined) throw new Error(`git-grove: ${move.branch} has no parent branch`);
    const edge = facts.edges.find((candidate) => candidate.branch === move.branch);
    const fork = await forkOf(root, edge, branch, parent, hints.get(move.branch)?.parentSha);
    const holder = holderIn(facts, move.branch);
    levels.push({
      move,
      number: numberOf(move.branch),
      label: `${numberOf(move.branch)} ${move.branch}`,
      ontoLabel: move.ontoTrunk ? facts.trunk.name : `${numberOf(move.onto)} ${move.onto}`,
      ontoRef: move.ontoTrunk ? facts.trunk.ref : `refs/heads/${move.onto}`,
      ontoSha: move.ontoTrunk ? facts.trunk.sha : parent.tip,
      parent: parentName,
      tip: branch.tip,
      fork,
      own: await countCommits(root, `${fork}..${branch.tip}`),
      edge,
      holder,
      dirty: holder === undefined ? [] : await readDirtyPaths(holder.path),
      busy: busyIn(facts, move.branch),
    });
  }

  const [first] = levels;
  const tips = new Map<string, Sha>();
  for (const level of feature.levels) {
    const tip = branches.get(level.branch)?.tip;
    if (tip !== undefined) tips.set(level.branch, tip);
  }
  return {
    feature,
    stash,
    stashMessage: `grove restack ${feature.name}`,
    levels,
    untouched: untouched.map((branch) => `${numberOf(branch)} ${branch}`),
    tips,
    trunk: facts.trunk,
    rewritten: rewrittenLevels(ctx.store, facts.commonDir, feature.levels.map((level) => level.branch)),
    conflicts: first === undefined ? [] : await predictConflicts(root, first.fork, first.ontoSha, first.tip),
  };
}
