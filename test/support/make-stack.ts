import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runGit } from "../../src/core/git/run-git.js";
import type { TestRepo } from "./make-repo.js";

export type StackLevelSpec = { branch: string; parent: string; file: string };

const MAX_DEPTH = 64;

async function depthOf(repo: TestRepo, branch: string): Promise<number> {
  let depth = 0;
  for (let name = branch; depth < MAX_DEPTH; depth++) {
    const parent = await runGit(["config", "--get", `branch.${name}.stackparent`], { cwd: repo.path, allowFailure: true });
    if (parent.code !== 0) return depth;
    name = parent.stdout.trim();
  }
  return depth;
}

/**
 * Adds stack levels in order, each in `.worktrees/<feature>/<NN>-<branch with / as ->` on top of its parent, with one
 * commit adding `file`. Records `stackparent` and `stackforkpoint`, and `grovefeature` on a level whose parent is the
 * trunk. Resolves to each branch's worktree path.
 */
export async function makeStack(
  repo: TestRepo,
  spec: { feature: string; levels: StackLevelSpec[] },
): Promise<Record<string, string>> {
  const paths: Record<string, string> = {};
  for (const level of spec.levels) {
    const depth = (await depthOf(repo, level.parent)) + 1;
    const name = `${String(depth).padStart(2, "0")}-${level.branch.replaceAll("/", "-")}`;
    const folder = join(repo.path, ".worktrees", spec.feature, name);
    const fork = (await repo.git("rev-parse", level.parent)).trim();
    await repo.git("worktree", "add", "-b", level.branch, folder, level.parent);
    await mkdir(dirname(join(folder, level.file)), { recursive: true });
    await writeFile(join(folder, level.file), `${level.branch}\n`);
    await repo.git("-C", folder, "add", "--", level.file);
    await repo.git("-C", folder, "commit", "-m", `add ${level.file}`);
    await repo.git("config", `branch.${level.branch}.stackparent`, level.parent);
    await repo.git("config", `branch.${level.branch}.stackforkpoint`, fork);
    if (depth === 1) await repo.git("config", `branch.${level.branch}.grovefeature`, spec.feature);
    paths[level.branch] = folder;
  }
  return paths;
}
