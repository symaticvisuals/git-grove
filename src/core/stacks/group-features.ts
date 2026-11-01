import type { RepoFacts, StackEdge } from "../facts/facts.types.js";
import type { FeatureGroup } from "./stacks.types.js";

/**
 * Groups branches into features without touching git.
 * A stack is every branch connected through edges to a root whose parent is the trunk or a branch that no longer exists;
 * roots that name the same `grovefeature` form one stack of several trees, ordered by `rootRank` (lowest first, then
 * as configured). Its branches are ordered tree by tree, parent before child. A single is a branch with a worktree
 * outside every stack. All non-prunable detached worktrees form one `detached` feature. The trunk is never a feature.
 */
export function groupFeatures(facts: RepoFacts, rootRank: ReadonlyMap<string, number> = new Map()): FeatureGroup[] {
  const existing = new Set(facts.branches.map((branch) => branch.name));
  const edges = facts.edges.filter((edge) => edge.branch !== facts.trunk.name && existing.has(edge.branch));
  const children = new Map<string, string[]>();
  for (const edge of edges) children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.branch]);

  const roots = edges.filter((edge) => edge.parent === facts.trunk.name || !existing.has(edge.parent));
  const inStack = new Set<string>();
  const groups: FeatureGroup[] = [];

  const forests = new Map<string, StackEdge[]>();
  for (const root of roots) {
    const key = root.feature === null ? `branch:${root.branch}` : `feature:${root.feature}`;
    forests.set(key, [...(forests.get(key) ?? []), root]);
  }
  for (const trees of forests.values()) {
    const ordered = [...trees].sort((one, other) => (rootRank.get(one.branch) ?? 0) - (rootRank.get(other.branch) ?? 0));
    const branches: string[] = [];
    for (const root of ordered) {
      const queue = [root.branch];
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (inStack.has(next)) continue;
        inStack.add(next);
        branches.push(next);
        queue.push(...(children.get(next) ?? []));
      }
    }
    const [first] = ordered;
    if (first !== undefined) groups.push({ name: first.feature ?? first.branch, kind: "stack", branches });
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
