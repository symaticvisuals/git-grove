export type ReasonCode =
  | "uncommitted"
  | "untracked"
  | "unpushed"
  | "detached-only"
  | "stash"
  | "precious-ignored"
  | "too-many-ignored"
  | "nested-worktree"
  | "nested-repo"
  | "unreadable"
  | "main-worktree";

export type Reason = { code: ReasonCode; detail: string; paths: string[] };

export type Verdict = { ok: boolean; reasons: Reason[] };

export type RemovalFacts = {
  path: string;
  uncommitted: number;
  untracked: string[];
  unpushed: number;
  detachedCommits: number;
  stashes: number;
  preciousIgnored: string[];
  ignoredTruncated: boolean;
  nestedWorktrees: string[];
  /** Worktree-relative folders holding a git repository of their own that is not a registered worktree. */
  nestedRepos: string[];
  unreadable: string[];
};
