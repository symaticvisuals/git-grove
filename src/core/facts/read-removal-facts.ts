import { access } from "node:fs/promises";
import { join, sep } from "node:path";
import { runGit } from "../git/run-git.js";
import { isMerged } from "../stacks/is-merged.js";
import type { RemovalFacts } from "../rules/verdict.types.js";
import { countDetachedOnly } from "./count-detached-only.js";
import type { RepoFacts, WorktreeFacts } from "./facts.types.js";
import { listIgnoredFiles } from "./list-ignored-files.js";
import { MainWorktreeError } from "./main-worktree.error.js";
import { NotAWorktreeError } from "./not-a-worktree.error.js";
import { sameFileInBoth } from "./same-file-in-both.js";

type Read<T> = { value: T; failed: string | null };

async function countCommits(cwd: string, args: string[]): Promise<number> {
  const { stdout } = await runGit(["rev-list", "--count", ...args], { cwd });
  return Number.parseInt(stdout.trim(), 10);
}

async function readUnpushed(cwd: string, worktree: WorktreeFacts, facts: RepoFacts): Promise<Read<number>> {
  const branch = facts.branches.find((candidate) => candidate.name === worktree.branch);
  if (!branch) return { value: 0, failed: null };
  try {
    const tracked = branch.upstream && !branch.upstream.gone ? branch.upstream : null;
    const ahead = tracked ? tracked.ahead : await countCommits(cwd, [`${facts.trunk.ref}..${branch.tip}`]);
    if (ahead === 0) return { value: 0, failed: null };
    return { value: (await isMerged(cwd, branch.tip, facts.trunk.ref)) ? 0 : ahead, failed: null };
  } catch {
    return { value: 0, failed: "unpushed commits" };
  }
}

async function readUncommitted(worktree: WorktreeFacts): Promise<Read<number>> {
  const result = await runGit(["status", "--porcelain=v2", "--untracked-files=no", "--ignore-submodules=none"], {
    cwd: worktree.path,
    allowFailure: true,
  }).catch(() => null);
  if (!result || result.code !== 0) return { value: 0, failed: "uncommitted changes" };
  return { value: result.stdout.split("\n").filter((line) => /^[12u] /.test(line)).length, failed: null };
}

async function readUntracked(worktree: WorktreeFacts, nested: string[]): Promise<Read<{ files: string[]; repos: string[] }>> {
  const result = await runGit(["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: worktree.path,
    allowFailure: true,
  }).catch(() => null);
  if (!result || result.code !== 0) return { value: { files: [], repos: [] }, failed: "untracked files" };
  const entries = result.stdout
    .split("\0")
    .filter((entry) => entry !== "" && !nested.includes(join(worktree.path, entry.replace(/\/$/, ""))));
  const files = entries.filter((entry) => !entry.endsWith("/"));
  const repos = entries.filter((entry) => entry.endsWith("/")).map((entry) => entry.slice(0, -1));
  return { value: { files, repos }, failed: null };
}

type Precious = { files: string[]; truncated: boolean; repos: string[] };

const NO_PRECIOUS: Precious = { files: [], truncated: false, repos: [] };

async function readPrecious(worktree: WorktreeFacts, main: WorktreeFacts, others: string[]): Promise<Read<Precious>> {
  try {
    const listing = await listIgnoredFiles(worktree.path, others);
    const failed = listing.unreadable.length > 0 ? `ignored files in ${listing.unreadable.join(", ")}` : null;
    const repos = listing.nestedRepos;
    if (listing.truncated) return { value: { files: [], truncated: true, repos }, failed };
    const kept: string[] = [];
    for (const file of listing.files) {
      if (!(await sameFileInBoth(worktree.path, main.path, file))) kept.push(file);
    }
    return { value: { files: kept, truncated: false, repos }, failed };
  } catch {
    return { value: NO_PRECIOUS, failed: "ignored files" };
  }
}

async function readDetached(cwd: string, worktree: WorktreeFacts): Promise<Read<number>> {
  if (worktree.branch !== null || worktree.head === null) return { value: 0, failed: null };
  return countDetachedOnly(cwd, worktree.head).then(
    (value) => ({ value, failed: null }),
    () => ({ value: 0, failed: "detached commits" }),
  );
}

async function folderExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Gathers everything that deleting a worktree could lose: uncommitted and untracked work,
 * commits that are neither pushed nor merged, commits only a detached HEAD holds, stashes for its branch,
 * ignored files that exist nowhere else, and worktrees and git repositories of their own nested inside it.
 * A read that fails is reported in `unreadable` and never counted as empty; the other reads still count.
 * A prunable worktree whose folder is gone skips the on-disk checks and keeps the repository-level ones;
 * one whose folder still exists is reported as unreadable.
 * Throws MainWorktreeError for the main worktree and NotAWorktreeError for a path that is no worktree.
 */
export async function readRemovalFacts(cwd: string, worktreePath: string, facts: RepoFacts): Promise<RemovalFacts> {
  const worktree = facts.worktrees.find((candidate) => candidate.path === worktreePath);
  const main = facts.worktrees.find((candidate) => candidate.isMain);
  if (!worktree) throw new NotAWorktreeError(worktreePath);
  if (worktree.isMain || !main) throw new MainWorktreeError(worktreePath);

  const others = facts.worktrees.filter((candidate) => candidate !== worktree).map((candidate) => candidate.path);
  const nestedWorktrees = others.filter((other) => other.startsWith(worktree.path + sep));
  const exists = await folderExists(worktree.path);
  const onDisk = !worktree.prunable && exists;
  const orphaned = worktree.prunable && exists ? ["folder (it exists but git no longer tracks it as a worktree)"] : [];

  const [uncommitted, untracked, precious, unpushed, detachedCommits] = await Promise.all([
    onDisk ? readUncommitted(worktree) : { value: 0, failed: null },
    onDisk ? readUntracked(worktree, nestedWorktrees) : { value: { files: [], repos: [] }, failed: null },
    onDisk ? readPrecious(worktree, main, others) : { value: NO_PRECIOUS, failed: null },
    readUnpushed(cwd, worktree, facts),
    readDetached(cwd, worktree),
  ]);

  return {
    path: worktree.path,
    uncommitted: uncommitted.value,
    untracked: untracked.value.files,
    unpushed: unpushed.value,
    detachedCommits: detachedCommits.value,
    stashes: worktree.branch === null ? 0 : facts.stashes.filter((stash) => stash.branch === worktree.branch).length,
    preciousIgnored: precious.value.files,
    ignoredTruncated: precious.value.truncated,
    nestedWorktrees,
    nestedRepos: [...new Set([...untracked.value.repos, ...precious.value.repos])].sort(),
    unreadable: [...orphaned, uncommitted.failed, untracked.failed, precious.failed, unpushed.failed, detachedCommits.failed].filter(
      (item) => item !== null,
    ),
  };
}
