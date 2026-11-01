import { runGit } from "../git/run-git.js";

const FIELDS_BEFORE_PATH: Record<string, number> = { "1": 8, "2": 9, u: 10, "?": 1 };

/**
 * Lists every path with a staged, unstaged, untracked or conflicted change in the worktree, relative to it and
 * sorted. A rename lists both its old and new path. Untracked folders are listed file by file.
 */
export async function readDirtyPaths(worktreePath: string): Promise<string[]> {
  const { stdout } = await runGit(["status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: worktreePath });
  const records = stdout.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < records.length; index++) {
    const record = records[index] ?? "";
    const fields = FIELDS_BEFORE_PATH[record[0] ?? ""];
    if (fields === undefined) continue;
    const parts = record.split(" ");
    paths.add(parts.slice(fields).join(" "));
    if (record[0] === "2") paths.add(records[++index] ?? "");
  }
  paths.delete("");
  return [...paths].sort();
}
