import { basename } from "node:path";
import type { RepoFacts } from "../facts/facts.types.js";
import { groupFeatures } from "../stacks/group-features.js";

function depthOf(facts: RepoFacts, branch: string, stack: readonly string[]): number {
  const parentOf = (name: string): string | undefined => facts.edges.find((edge) => edge.branch === name)?.parent;
  const seen = new Set([branch]);
  let parent = parentOf(branch);
  while (parent !== undefined && stack.includes(parent) && !seen.has(parent)) {
    seen.add(parent);
    parent = parentOf(parent);
  }
  return seen.size;
}

/** Where a branch sits, for a plan's heading: `<feature>, level 01` in a stack, `Singles`, or the repository's name. */
export function branchContext(facts: RepoFacts, branch: string): string {
  const group = groupFeatures(facts).find((candidate) => candidate.branches.includes(branch));
  if (group?.kind === "stack") return `${group.name}, level ${String(depthOf(facts, branch, group.branches)).padStart(2, "0")}`;
  if (group?.kind === "single") return "Singles";
  return basename(facts.root);
}
