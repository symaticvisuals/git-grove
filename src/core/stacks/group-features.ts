import type { RepoFacts } from "../facts/facts.types.js";
import type { FeatureGroup } from "./stacks.types.js";

/**
 * Groups branches into features without touching git.
 * A stack is every branch connected through edges to a root whose parent is the trunk or a branch that no longer exists;
 * its branches are ordered parent before child. A single is a branch with a worktree outside every stack.
 * All non-prunable detached worktrees form one `detached` feature. The trunk is never a feature.
 */
export function groupFeatures(facts: RepoFacts): FeatureGroup[] {
  const existing = new Set(facts.branches.map((branch) => branch.name));
  const edges = facts.edges.filter((edge) => edge.branch !== facts.trunk.name && existing.has(edge.branch));
  const children = new Map<string, string[]>();
  for (const edge of edges) children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.branch]);

  const roots = edges.filter((edge) => edge.parent === facts.trunk.name || !existing.has(edge.parent));
  const inStack = new Set<string>();
  const groups: FeatureGroup[] = [];

  for (const root of roots) {
    const branches: string[] = [];
    const queue = [root.branch];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (inStack.has(next)) continue;
      inStack.add(next);
      branches.push(next);
      queue.push(...(children.get(next) ?? []));
    }
    groups.push({ name: root.feature ?? root.branch, kind: "stack", branches });
  }

  for (const worktree of facts.worktrees) {
    const branch = worktree.branch;
    if (branch === null || branch === facts.trunk.name || inStack.has(branch)) continue;
    inStack.add(branch);
    groups.push({ name: branch, kind: "single", branches: [branch] });
  }

  if (facts.worktrees.some((worktree) => worktree.branch === null && !worktree.prunable)) {
    groups.push({ name: "detached", kind: "detached", branches: [] });
  }
  return groups;
}
