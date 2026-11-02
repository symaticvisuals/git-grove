import type { Sha } from "../facts/facts.types.js";
import { runGit } from "./run-git.js";

/** The commit `rev` names (`git rev-parse --verify --quiet <rev>^{commit}`), or null when it names none. */
export async function resolveCommit(cwd: string, rev: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}
