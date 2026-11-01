import type { RepoFacts } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";
import { branchLanded } from "./branch-landed.js";
import { forkOf } from "./fork-of.js";
import { groupFeatures } from "./group-features.js";
import type { Feature, Level } from "./stacks.types.js";

const CONCURRENCY = 8;

async function count(cwd: string, range: string): Promise<number> {
  return Number((await runGit(["rev-list", "--count", range], { cwd })).stdout.trim());
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      const item = items[index];
      if (item !== undefined) results[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Builds every feature with its levels: per-level drift against the parent's fork point and the trunk,
 * and whether the parent branch has already landed on the trunk. Git work runs with a concurrency of 8.
 */
export async function readStackFacts(cwd: string, facts: RepoFacts): Promise<Feature[]> {
  const branches = new Map(facts.branches.map((branch) => [branch.name, branch]));
  const edges = new Map(facts.edges.map((edge) => [edge.branch, edge]));
  const trunkName = facts.trunk.name;

  const buildLevel = async (name: string, depths: Map<string, number>): Promise<Level | null> => {
    const branch = branches.get(name);
    if (!branch) return null;
    const edge = edges.get(name);
    const parentName = edge?.parent ?? trunkName;
    const parentBranch = parentName === trunkName ? undefined : branches.get(parentName);
    const worktree = facts.worktrees.find((candidate) => candidate.branch === name) ?? null;

    const behindTrunk = await count(cwd, `${branch.tip}..${facts.trunk.ref}`);
    let parentCommitsSinceFork = 0;
    let parentMerged = false;
    if (parentBranch) {
      const fork = await forkOf(cwd, edge, branch, parentBranch);
      parentCommitsSinceFork = await count(cwd, `${fork}..${parentBranch.tip}`);
      parentMerged = await branchLanded(cwd, parentBranch, facts.trunk.ref);
    }
    const parentMissing = parentName !== trunkName && parentBranch === undefined;
    return {
      branch: name,
      parent: parentName,
      depth: depths.get(name) ?? 1,
      worktree,
      parentCommitsSinceFork,
      behindTrunk,
      parentMerged,
      parentMissing,
    };
  };

  const groups = groupFeatures(facts);
  const features: Feature[] = [];
  for (const group of groups) {
    const depths = new Map<string, number>();
    for (const name of group.branches) {
      const parent = edges.get(name)?.parent;
      depths.set(name, parent !== undefined && depths.has(parent) ? (depths.get(parent) ?? 0) + 1 : 1);
    }
    const levels = await mapLimited(group.branches, CONCURRENCY, (name) => buildLevel(name, depths));
    features.push({ name: group.name, kind: group.kind, levels: levels.filter((level): level is Level => level !== null) });
  }
  return features;
}
