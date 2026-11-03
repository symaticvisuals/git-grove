import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { runGit } from "../git/run-git.js";
import { parseWorktreeList, type RawWorktree } from "../git/parse-worktree-list.js";
import { BareRepoError } from "./bare-repo.error.js";
import type { BranchFacts, Operation, RepoFacts, StackEdge, WorktreeFacts } from "./facts.types.js";
import { NotARepoError } from "./not-a-repo.error.js";
import { resolveTrunk } from "./resolve-trunk.js";

const STATUS_CONCURRENCY = 8;
const PINS_NAMESPACE = "refs/grove/pins";

const OPERATION_MARKERS: readonly (readonly [string, Operation])[] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["BISECT_LOG", "bisect"],
];

async function mtimeMs(path: string): Promise<number | null> {
  try {
    return Math.floor((await stat(path)).mtimeMs);
  } catch {
    return null;
  }
}

async function rebaseBranch(gitDir: string): Promise<string | null> {
  for (const folder of ["rebase-merge", "rebase-apply"]) {
    const headName = await readFile(join(gitDir, folder, "head-name"), "utf8").catch(() => null);
    const ref = headName?.trim() ?? "";
    if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  }
  return null;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function countChanges(porcelainV2: string): { staged: number; unstaged: number; untracked: number } {
  const changes = { staged: 0, unstaged: 0, untracked: 0 };
  for (const line of porcelainV2.split("\n")) {
    if (line.startsWith("? ")) changes.untracked++;
    else if (line.startsWith("u ")) changes.unstaged++;
    else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      if (line[2] !== ".") changes.staged++;
      if (line[3] !== ".") changes.unstaged++;
    }
  }
  return changes;
}

async function readWorktree(raw: RawWorktree, isMain: boolean, commonDir: string): Promise<WorktreeFacts> {
  if (raw.prunable || !existsSync(raw.path)) {
    return {
      path: raw.path,
      gitDir: join(commonDir, "worktrees", basename(raw.path)),
      head: raw.head,
      branch: raw.branch,
      isMain,
      locked: raw.locked,
      // A missing unlocked folder is prunable even when git has not said so; a lock keeps it until `git worktree unlock`.
      prunable: raw.prunable || (!isMain && !raw.locked),
      operation: null,
      operationBranch: null,
      changes: null,
      touchedAt: null,
    };
  }
  const [gitDirOut, statusOut] = await Promise.all([
    runGit(["rev-parse", "--absolute-git-dir"], { cwd: raw.path, allowFailure: true }).catch(() => null),
    runGit(["status", "--porcelain=v2", "--untracked-files=normal"], { cwd: raw.path, allowFailure: true }).catch(() => null),
  ]);
  const gitDir =
    gitDirOut?.code === 0 ? gitDirOut.stdout.trim() : isMain ? commonDir : join(commonDir, "worktrees", basename(raw.path));
  const marker = OPERATION_MARKERS.find(([name]) => existsSync(join(gitDir, name)));
  const times = (await Promise.all([mtimeMs(join(gitDir, "index")), mtimeMs(join(gitDir, "HEAD"))])).filter(
    (time): time is number => time !== null,
  );
  return {
    path: raw.path,
    gitDir,
    head: raw.head,
    branch: raw.branch,
    isMain,
    locked: raw.locked,
    prunable: false,
    operation: marker ? marker[1] : null,
    operationBranch: marker?.[1] === "rebase" ? await rebaseBranch(gitDir) : null,
    changes: statusOut?.code === 0 ? countChanges(statusOut.stdout) : null,
    touchedAt: times.length > 0 ? Math.max(...times) : null,
  };
}

function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (track === "gone") return { ahead: 0, behind: 0, gone: true };
  return {
    gone: false,
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
  };
}

async function readBranches(cwd: string): Promise<BranchFacts[]> {
  const format = "%(refname:lstrip=2)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)";
  const { stdout } = await runGit(["for-each-ref", `--format=${format}`, "refs/heads"], { cwd });
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name = "", tip = "", upstream = "", track = ""] = line.split("\0");
      return { name, tip, upstream: upstream === "" ? null : { ref: upstream, ...parseTrack(track) } };
    });
}

async function readEdges(cwd: string): Promise<StackEdge[]> {
  const { stdout } = await runGit(
    ["config", "--get-regexp", "^branch\\..*\\.(stackparent|stackforkpoint|grovefeature)$"],
    { cwd, allowFailure: true },
  );
  const byBranch = new Map<string, Partial<Record<"stackparent" | "stackforkpoint" | "grovefeature", string>>>();
  for (const line of stdout.split("\n")) {
    const match = /^branch\.(.+)\.(stackparent|stackforkpoint|grovefeature) (.*)$/.exec(line);
    if (!match) continue;
    const [, branch = "", key = "", value = ""] = match;
    if (key !== "stackparent" && key !== "stackforkpoint" && key !== "grovefeature") continue;
    byBranch.set(branch, { ...byBranch.get(branch), [key]: value });
  }
  const edges: StackEdge[] = [];
  for (const [branch, keys] of byBranch) {
    if (keys.stackparent === undefined) continue;
    edges.push({
      branch,
      parent: keys.stackparent,
      forkPoint: keys.stackforkpoint ?? null,
      feature: keys.grovefeature ?? null,
    });
  }
  return edges;
}

async function readStashes(cwd: string): Promise<RepoFacts["stashes"]> {
  const { stdout } = await runGit(["stash", "list", "--format=%gd%x00%gs"], { cwd });
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [ref = "", subject = ""] = line.split("\0");
      const branch = /^(?:WIP on|On) (.+?):/.exec(subject)?.[1];
      return { ref, branch: branch === undefined || branch === "(no branch)" ? null : branch };
    });
}

async function readPins(cwd: string): Promise<RepoFacts["pins"]> {
  const { stdout } = await runGit(["for-each-ref", "--format=%(refname) %(objectname)", PINS_NAMESPACE], { cwd });
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [ref = "", sha = ""] = line.split(" ");
      return { ref, sha };
    });
}

/**
 * Reads everything git says about the repository containing `cwd`, with no judgment applied.
 * Throws NotARepoError outside a repository and in one with no commits, and BareRepoError when the repository
 * is bare, including the layout of a bare repository with linked worktrees beside it.
 */
export async function readRepoFacts(cwd: string): Promise<RepoFacts> {
  const probe = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir", "--is-bare-repository"], {
    cwd,
    allowFailure: true,
  }).catch(() => null);
  const [commonDir, bare] = probe?.code === 0 ? probe.stdout.trim().split("\n") : [];
  if (commonDir === undefined) throw new NotARepoError(`git-grove: not inside a git repository (${cwd})`);
  if (bare === "true") throw new BareRepoError();

  const raws = parseWorktreeList((await runGit(["worktree", "list", "--porcelain", "-z"], { cwd })).stdout);
  if (raws[0]?.bare) throw new BareRepoError();
  const root = raws[0]?.path;
  if (root === undefined) throw new NotARepoError(`git-grove: not inside a git repository (${cwd})`);
  if ((await runGit(["rev-parse", "--verify", "HEAD"], { cwd: root, allowFailure: true })).code !== 0) {
    throw new NotARepoError("git-grove: this repository has no commits yet");
  }

  const [trunk, branches, edges, stashes, pins, lastFetchAt, worktrees] = await Promise.all([
    resolveTrunk(root),
    readBranches(root),
    readEdges(root),
    readStashes(root),
    readPins(root),
    mtimeMs(join(commonDir, "FETCH_HEAD")),
    mapLimit(raws, STATUS_CONCURRENCY, (raw) => readWorktree(raw, raw === raws[0], commonDir)),
  ]);

  return { root, commonDir, trunk, lastFetchAt, worktrees, branches, edges, stashes, pins, readAt: Date.now() };
}
