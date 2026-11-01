import type { Feature } from "../../stacks/stacks.types.js";

export type RestackMove = {
  branch: string;
  onto: string;
  ontoTrunk: boolean;
  reason: "parent-moved" | "parent-merged" | "parent-restacked";
};

/**
 * Which levels of a feature a restack moves, parent before child, and which levels above level 1 it leaves alone.
 * Level 1 never moves. A level whose parent merged moves onto the trunk; one whose parent gained commits since its fork,
 * or whose parent moves, moves onto its parent.
 */
export function orderRestack(feature: Feature, trunkName: string): { moves: RestackMove[]; untouched: string[] } {
  const moves: RestackMove[] = [];
  const untouched: string[] = [];
  const moving = new Set<string>();
  for (const level of [...feature.levels].sort((one, other) => one.depth - other.depth)) {
    if (level.depth <= 1) continue;
    const reason: RestackMove["reason"] | null = level.parentMerged
      ? "parent-merged"
      : level.parentCommitsSinceFork > 0
        ? "parent-moved"
        : moving.has(level.parent)
          ? "parent-restacked"
          : null;
    if (reason === null) {
      untouched.push(level.branch);
      continue;
    }
    moving.add(level.branch);
    const ontoTrunk = reason === "parent-merged";
    moves.push({ branch: level.branch, onto: ontoTrunk ? trunkName : level.parent, ontoTrunk, reason });
  }
  return { moves, untouched };
}
