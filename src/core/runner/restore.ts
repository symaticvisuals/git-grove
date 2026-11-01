import { readRepoFacts } from "../facts/read-repo-facts.js";
import { runGit } from "../git/run-git.js";
import { restoreHeld, type RestoreResult } from "./restore-held.js";
import { withRepoLock } from "./with-repo-lock.js";

/** Takes the repo lock, reads the repository and runs {@link restoreHeld} under the lock. */
export async function restore(
  cwd: string,
  branch: string,
  pinRef?: string,
  beforeMove?: () => Promise<void>,
): Promise<RestoreResult> {
  const probe = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  return withRepoLock(probe.stdout.trim(), async () => restoreHeld(await readRepoFacts(cwd), branch, pinRef, beforeMove));
}
