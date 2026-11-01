import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RepoFacts } from "./facts.types.js";
import { listIgnoredFiles } from "./list-ignored-files.js";

const ENV_SCAN_LIMIT = 100_000;

function isEnvFile(relative: string): boolean {
  return basename(relative).startsWith(".env");
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Maps each linked worktree's path to the ignored `.env*` files the main worktree has and it lacks.
 * Prunable worktrees are left out.
 */
export async function readEnvMissing(
  _cwd: string,
  facts: RepoFacts,
  scanLimit: number = ENV_SCAN_LIMIT,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const main = facts.worktrees.find((worktree) => worktree.isMain);
  if (!main) return result;
  const listing = await listIgnoredFiles(
    main.path,
    facts.worktrees.filter((worktree) => !worktree.isMain).map((worktree) => worktree.path),
    { limit: scanLimit, accept: isEnvFile },
  );
  const envFiles = listing.files;
  for (const worktree of facts.worktrees) {
    if (worktree.isMain || worktree.prunable) continue;
    const missing: string[] = [];
    for (const file of envFiles) {
      if (!(await exists(join(worktree.path, file)))) missing.push(file);
    }
    result.set(worktree.path, missing);
  }
  return result;
}
