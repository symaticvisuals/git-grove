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
 * Parses `git worktree list --porcelain -z` output into one entry per worktree. Every attribute ends in a NUL and an
 * empty attribute ends an entry, so a path holding a newline stays whole.
 */
export function parseWorktreeList(porcelain: string): RawWorktree[] {
  const worktrees: RawWorktree[] = [];
  let current: RawWorktree | null = null;
  for (const line of porcelain.split("\0")) {
    if (line === "") {
      current = null;
    } else if (line.startsWith("worktree ")) {
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
  return worktrees;
}
