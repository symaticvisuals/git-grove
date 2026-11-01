import type { Sha } from "../facts/facts.types.js";
import { GitError } from "../git/git.error.js";
import { isAncestor } from "../git/is-ancestor.js";
import { runGit } from "../git/run-git.js";
import { unlessGitFails } from "../git/unless-git-fails.js";

const DIFF_FLAGS = ["--no-color", "--no-textconv", "--no-ext-diff"];

type PatchId = { patchId: string; commit: Sha };

async function verbatimPatchIds(cwd: string, patches: string): Promise<PatchId[]> {
  if (patches === "") return [];
  const { stdout } = await runGit(["patch-id", "--verbatim"], { cwd, input: patches });
  return stdout.split("\n").flatMap((line) => {
    const [patchId, commit] = line.split(" ");
    return patchId && commit ? [{ patchId, commit }] : [];
  });
}

async function diffPatchId(cwd: string, from: string, to: string): Promise<string | null> {
  const diff = await runGit(["diff", ...DIFF_FLAGS, from, to], { cwd });
  return (await verbatimPatchIds(cwd, diff.stdout))[0]?.patchId ?? null;
}

async function commitPatchIds(cwd: string, range: string): Promise<PatchId[]> {
  const log = await runGit(["log", "-p", ...DIFF_FLAGS, "--diff-merges=off", "--format=commit %H", range], { cwd });
  return verbatimPatchIds(cwd, log.stdout);
}

/**
 * Reports whether a trunk commit since `base` has, byte for byte, the patch of all of `tip`'s changes since `base`,
 * with no later trunk commit carrying the patch that reverts it.
 */
async function squashLanded(cwd: string, tip: Sha, base: Sha, trunkRef: string): Promise<boolean> {
  const own = await diffPatchId(cwd, base, tip);
  if (own === null) return false;
  const landings = (await commitPatchIds(cwd, `${base}..${trunkRef}`)).filter((entry) => entry.patchId === own);
  for (const { commit } of landings) {
    const revert = await diffPatchId(cwd, commit, `${commit}^`);
    const later = await commitPatchIds(cwd, `${commit}..${trunkRef}`);
    if (!later.some((entry) => entry.patchId === revert)) return true;
  }
  return false;
}

/**
 * Reports whether `tip` is already contained in `trunkRef`: as an ancestor, because merging it would leave
 * the trunk's tree unchanged (a squash or rebase merge), or because a trunk commit has the verbatim patch of all of
 * `tip`'s changes since the merge base and no later trunk commit reverts it (a squash merge the trunk has since built on).
 * A tip with no history in common with the trunk is not merged, nor is one whose patch comparison git fails on;
 * any other git failure throws GitError.
 */
export async function isMerged(cwd: string, tip: Sha, trunkRef: string): Promise<boolean> {
  if (await isAncestor(cwd, tip, trunkRef)) return true;
  const baseArgs = ["merge-base", tip, trunkRef];
  const base = await runGit(baseArgs, { cwd, allowFailure: true });
  if (base.code === 1) return false;
  if (base.code !== 0) throw new GitError(baseArgs, base.code, base.stderr);

  const mergeArgs = ["merge-tree", "--write-tree", trunkRef, tip];
  const merge = await runGit(mergeArgs, { cwd, allowFailure: true });
  if (merge.code > 1) throw new GitError(mergeArgs, merge.code, merge.stderr);
  if (merge.code === 0) {
    const trunkTree = (await runGit(["rev-parse", `${trunkRef}^{tree}`], { cwd })).stdout.trim();
    if (merge.stdout.split("\n")[0]?.trim() === trunkTree) return true;
  }
  return unlessGitFails(squashLanded(cwd, tip, base.stdout.trim(), trunkRef), false);
}
