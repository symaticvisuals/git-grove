import type { WorktreeFacts } from "../facts/facts.types.js";

export type Level = {
  branch: string;
  parent: string;
  depth: number;
  worktree: WorktreeFacts | null;
  parentCommitsSinceFork: number;
  behindTrunk: number;
  parentMerged: boolean;
  parentMissing: boolean;
};

export type FeatureKind = "stack" | "single" | "detached";

export type Feature = { name: string; kind: FeatureKind; levels: Level[] };

export type FeatureGroup = { name: string; kind: FeatureKind; branches: string[] };
