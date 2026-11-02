import { existsSync } from "node:fs";
import { runGit } from "../git/run-git.js";

/** An operation in progress in a worktree, and the command that drops it. */
export type Operation = { name: string; abort: string };

const MARKERS: readonly (readonly [string, Operation])[] = [
  ["rebase-merge", { name: "rebase", abort: "git rebase --abort" }],
  ["rebase-apply", { name: "rebase", abort: "git rebase --abort" }],
  ["MERGE_HEAD", { name: "merge", abort: "git merge --abort" }],
  ["CHERRY_PICK_HEAD", { name: "cherry-pick", abort: "git cherry-pick --abort" }],
  ["REVERT_HEAD", { name: "revert", abort: "git revert --abort" }],
];

/** The rebase, merge, cherry-pick or revert in progress in the worktree around `cwd`, from `git rev-parse --git-path`; null for none. */
export async function readOperation(cwd: string): Promise<Operation | null> {
  const args = ["rev-parse", "--path-format=absolute", ...MARKERS.flatMap(([marker]) => ["--git-path", marker])];
  const result = await runGit(args, { cwd, allowFailure: true });
  if (result.code !== 0) return null;
  const paths = result.stdout.split("\n");
  const found = MARKERS.find((_, index) => existsSync(paths[index] ?? ""));
  return found === undefined ? null : found[1];
}
