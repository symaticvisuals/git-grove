import { realpath } from "node:fs/promises";
import { parseWorktreeList } from "../git/parse-worktree-list.js";
import { runGit } from "../git/run-git.js";

/**
 * The real path of every linked worktree folder of the repository `cwd` is in, the main worktree left out; a folder
 * that no longer resolves is kept as git lists it. Throws GitError when git cannot list them.
 */
export async function readLinkedRoots(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(["worktree", "list", "--porcelain"], { cwd });
  const linked = parseWorktreeList(stdout).slice(1);
  return Promise.all(linked.map((worktree) => realpath(worktree.path).catch(() => worktree.path)));
}
