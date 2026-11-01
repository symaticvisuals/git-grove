import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";

function holdsGit(path: string): boolean {
  try {
    return lstatSync(join(path, ".git"), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * The worktree-relative folder of a git repository nested inside `worktree` that holds one of `files`, or null.
 * Copying such a file would leave that repository's own history behind in the folder being removed.
 */
export function nestedRepoOf(worktree: string, files: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const file of files) {
    for (let folder = dirname(file); folder !== "." && folder !== "/" && !seen.has(folder); folder = dirname(folder)) {
      seen.add(folder);
      if (holdsGit(join(worktree, folder))) return folder;
    }
  }
  return null;
}
