import { realpath, stat } from "node:fs/promises";
import { parseWorktreeList } from "../git/parse-worktree-list.js";
import { runGit } from "../git/run-git.js";

/** A linked worktree's folder: its real path, and its `(dev, ino)` identity, null when the folder is gone. */
export type LinkedRoot = { path: string; id: { dev: bigint; ino: bigint } | null };

/**
 * Every linked worktree folder of the repository `cwd` is in, the main worktree left out. A folder that no longer
 * resolves is kept as git lists it, with no identity. Throws GitError when git cannot list them.
 */
export async function readLinkedRoots(cwd: string): Promise<LinkedRoot[]> {
  const { stdout } = await runGit(["worktree", "list", "--porcelain", "-z"], { cwd });
  return Promise.all(
    parseWorktreeList(stdout)
      .slice(1)
      .map(async (worktree) => {
        const path = await realpath(worktree.path).catch(() => worktree.path);
        const stats = await stat(path, { bigint: true }).catch(() => null);
        return { path, id: stats === null ? null : { dev: stats.dev, ino: stats.ino } };
      }),
  );
}
