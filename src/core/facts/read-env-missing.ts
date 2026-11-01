import { access } from "node:fs/promises";
import { join } from "node:path";
import type { RepoFacts } from "./facts.types.js";
import { listMainEnvFiles } from "./list-main-env-files.js";

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Maps each linked worktree's path to the ignored `.env*` files the main worktree has and it lacks.
 * Prunable and detached worktrees (agent sandboxes) are left out, and so are files inside folders of the main worktree that cannot be opened.
 */
export async function readEnvMissing(
  _cwd: string,
  facts: RepoFacts,
  scanLimit?: number,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const envFiles = await listMainEnvFiles(facts, scanLimit);
  for (const worktree of facts.worktrees) {
    if (worktree.isMain || worktree.prunable || worktree.branch === null) continue;
    const missing: string[] = [];
    for (const file of envFiles) {
      if (!(await exists(join(worktree.path, file)))) missing.push(file);
    }
    result.set(worktree.path, missing);
  }
  return result;
}
