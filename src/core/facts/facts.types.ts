export type Sha = string;

export type Operation = "rebase" | "merge" | "cherry-pick" | "bisect";

export type WorktreeFacts = {
  path: string;
  gitDir: string;
  head: Sha | null;
  branch: string | null;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  operation: Operation | null;
  /** The branch an in-progress rebase is rewriting, read from its `head-name`; null otherwise. */
  operationBranch: string | null;
  changes: { staged: number; unstaged: number; untracked: number } | null;
  touchedAt: number | null;
};

export type BranchFacts = {
  name: string;
  tip: Sha;
  upstream: { ref: string; ahead: number; behind: number; gone: boolean } | null;
};

export type StackEdge = { branch: string; parent: string; forkPoint: Sha | null; feature: string | null };

export type RepoFacts = {
  root: string;
  commonDir: string;
  trunk: { name: string; ref: string; sha: Sha };
  lastFetchAt: number | null;
  worktrees: WorktreeFacts[];
  branches: BranchFacts[];
  edges: StackEdge[];
  stashes: { ref: string; branch: string | null }[];
  pins: { ref: string; sha: Sha }[];
  readAt: number;
};
