import { join, sep } from "node:path";
import { runGit } from "../git/run-git.js";
import { isMerged } from "../stacks/is-merged.js";
import type { RemovalFacts } from "../rules/verdict.types.js";
import type { RepoFacts, WorktreeFacts } from "./facts.types.js";
import { listIgnoredFiles } from "./list-ignored-files.js";
import { MainWorktreeError } from "./main-worktree.error.js";
import { sameFileInBoth } from "./same-file-in-both.js";

async function countCommits(cwd: string, args: string[]): Promise<number> {
  const { stdout } = await runGit(["rev-list", "--count", ...args], { cwd });
  return Number.parseInt(stdout.trim(), 10);
}

async function readUnpushed(cwd: string, worktree: WorktreeFacts, facts: RepoFacts): Promise<number> {
  const branch = facts.branches.find((candidate) => candidate.name === worktree.branch);
  if (!branch) return 0;
  const ahead = branch.upstream ? branch.upstream.ahead : await countCommits(cwd, [`${facts.trunk.ref}..${branch.name}`]);
  if (ahead === 0) return 0;
  return (await isMerged(cwd, branch.tip, facts.trunk.ref)) ? 0 : ahead;
}

async function readUntracked(worktree: WorktreeFacts, nested: string[]): Promise<string[]> {
  if (!worktree.changes || worktree.changes.untracked === 0) return [];
  const { stdout } = await runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: worktree.path });
  return stdout.split("\0").filter((entry) => entry !== "" && !nested.includes(join(worktree.path, entry.replace(/\/$/, ""))));
}

async function readPrecious(worktree: WorktreeFacts, main: WorktreeFacts, others: string[]) {
  const listing = await listIgnoredFiles(worktree.path, others);
  if (listing.truncated) return { files: [], truncated: true };
  const kept: string[] = [];
  for (const file of listing.files) {
    if (!(await sameFileInBoth(worktree.path, main.path, file))) kept.push(file);
  }
  return { files: kept, truncated: false };
}

/**
 * Gathers everything that deleting a worktree could lose: uncommitted and untracked work,
 * commits that are neither pushed nor merged, commits only a detached HEAD holds, stashes for its branch,
 * ignored files that exist nowhere else, and worktrees nested inside it.
 * Throws MainWorktreeError for the main worktree.
 */
export async function readRemovalFacts(cwd: string, worktreePath: string, facts: RepoFacts): Promise<RemovalFacts> {
  const worktree = facts.worktrees.find((candidate) => candidate.path === worktreePath);
  const main = facts.worktrees.find((candidate) => candidate.isMain);
  if (!worktree) throw new Error(`${worktreePath} is not a worktree of this repository`);
  if (worktree.isMain || !main) throw new MainWorktreeError(worktreePath);

  const others = facts.worktrees.filter((candidate) => candidate !== worktree).map((candidate) => candidate.path);
  const nestedWorktrees = others.filter((other) => other.startsWith(worktree.path + sep));

  const [untracked, unpushed, detachedCommits, precious] = await Promise.all([
    readUntracked(worktree, nestedWorktrees),
    readUnpushed(cwd, worktree, facts),
    worktree.branch === null && worktree.head !== null
      ? countCommits(worktree.path, ["HEAD", "--not", "--branches", "--remotes", "--tags"])
      : Promise.resolve(0),
    readPrecious(worktree, main, others),
  ]);

  return {
    path: worktree.path,
    uncommitted: (worktree.changes?.staged ?? 0) + (worktree.changes?.unstaged ?? 0),
    untracked,
    unpushed,
    detachedCommits,
    stashes: worktree.branch === null ? 0 : facts.stashes.filter((stash) => stash.branch === worktree.branch).length,
    preciousIgnored: precious.files,
    ignoredTruncated: precious.truncated,
    nestedWorktrees,
  };
}
