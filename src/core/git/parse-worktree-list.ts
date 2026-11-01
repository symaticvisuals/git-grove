export type RawWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
};

const HEADS_PREFIX = "refs/heads/";

/**
 * Parses `git worktree list --porcelain` output into one entry per worktree.
 */
export function parseWorktreeList(porcelain: string): RawWorktree[] {
  const worktrees: RawWorktree[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    let current: RawWorktree | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        current = { path: line.slice("worktree ".length), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false };
        worktrees.push(current);
      } else if (current) {
        if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
        else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length);
          current.branch = ref.startsWith(HEADS_PREFIX) ? ref.slice(HEADS_PREFIX.length) : ref;
        } else if (line === "bare") current.bare = true;
        else if (line === "detached") current.detached = true;
        else if (line === "locked" || line.startsWith("locked ")) current.locked = true;
        else if (line === "prunable" || line.startsWith("prunable ")) current.prunable = true;
      }
    }
  }
  return worktrees;
}
