import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { BareRepoError } from "../core/facts/bare-repo.error.js";
import type { RepoFacts, WorktreeFacts } from "../core/facts/facts.types.js";
import { NotARepoError } from "../core/facts/not-a-repo.error.js";
import { readRepoFacts } from "../core/facts/read-repo-facts.js";
import { openStore } from "../core/journal/open-store.js";
import { groupFeatures } from "../core/stacks/group-features.js";
import { featureId } from "../server/wire/feature-id.js";
import type { DashboardTarget } from "./dashboard-url.js";

async function realOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

async function worktreeContaining(facts: RepoFacts, cwd: string): Promise<WorktreeFacts | null> {
  const here = await realOrSelf(cwd);
  let best: { worktree: WorktreeFacts; length: number } | null = null;
  for (const worktree of facts.worktrees) {
    const root = await realOrSelf(worktree.path);
    const inside = here === root || here.startsWith(root.endsWith(sep) ? root : root + sep);
    if (inside && (best === null || root.length > best.length)) best = { worktree, length: root.length };
  }
  return best?.worktree ?? null;
}

/**
 * Registers the repository around `cwd` in `<home>/grove.db` and names what of it to open: the feature of the
 * worktree holding `cwd`, or just the repository from the trunk, a detached worktree or a branch in no feature.
 * Null outside a repository, in one with no commits, and in a bare one.
 */
export async function dashboardTarget(cwd: string, home: string): Promise<DashboardTarget | null> {
  let facts: RepoFacts;
  try {
    facts = await readRepoFacts(cwd);
  } catch (error) {
    if (error instanceof NotARepoError || error instanceof BareRepoError) return null;
    throw error;
  }
  const store = openStore(join(home, "grove.db"));
  let repoId: number;
  try {
    repoId = store.repoId(facts.commonDir, facts.root);
  } finally {
    store.close();
  }
  const branch = (await worktreeContaining(facts, cwd))?.branch ?? null;
  const feature = branch === null ? undefined : groupFeatures(facts).find((group) => group.kind !== "detached" && group.branches.includes(branch));
  return { repoId, featureId: feature === undefined ? null : featureId(repoId, feature.name) };
}
