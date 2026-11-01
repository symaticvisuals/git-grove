import type { Sha } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";

export type OwnCommit = { sha: Sha; patchId: string | null; meta: string };

function parsePatchIds(output: string): Map<Sha, string> {
  const ids = new Map<Sha, string>();
  for (const line of output.split("\n")) {
    const [patchId, commit] = line.split(" ");
    if (patchId && commit) ids.set(commit, patchId);
  }
  return ids;
}

/**
 * Lists the commits in `base..tip`, oldest first, with each one's stable patch ID and its
 * `authorEmail\0authorTime\0subject` metadata. Merge and empty commits have no patch ID.
 */
export async function ownCommits(cwd: string, base: Sha, tip: Sha): Promise<OwnCommit[]> {
  const range = `${base}..${tip}`;
  const [listed, patches] = await Promise.all([
    runGit(["rev-list", "--reverse", "--no-commit-header", "--format=%H%x00%ae%x00%at%x00%s", range], { cwd }),
    runGit(
      ["log", "-p", "--no-color", "--no-textconv", "--no-ext-diff", "--diff-merges=off", "--format=commit %H", range],
      { cwd },
    ),
  ]);
  const patchIds =
    patches.stdout === ""
      ? new Map<Sha, string>()
      : parsePatchIds((await runGit(["patch-id", "--stable"], { cwd, input: patches.stdout })).stdout);
  return listed.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const separator = line.indexOf("\0");
      const sha = line.slice(0, separator);
      return { sha, patchId: patchIds.get(sha) ?? null, meta: line.slice(separator + 1) };
    });
}
