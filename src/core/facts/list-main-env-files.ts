import { basename } from "node:path";
import type { RepoFacts } from "./facts.types.js";
import { listIgnoredFiles } from "./list-ignored-files.js";

const ENV_SCAN_LIMIT = 100_000;

function isEnvFile(relative: string): boolean {
  return basename(relative).startsWith(".env");
}

/**
 * Lists the ignored `.env*` files of the main worktree, relative to it. Linked worktrees inside it are not searched,
 * and an empty list means there are none or `scanLimit` files were examined first.
 */
export async function listMainEnvFiles(facts: RepoFacts, scanLimit: number = ENV_SCAN_LIMIT): Promise<string[]> {
  const main = facts.worktrees.find((worktree) => worktree.isMain);
  if (main === undefined) return [];
  const others = facts.worktrees.filter((worktree) => !worktree.isMain).map((worktree) => worktree.path);
  return (await listIgnoredFiles(main.path, others, { limit: scanLimit, accept: isEnvFile })).files;
}
