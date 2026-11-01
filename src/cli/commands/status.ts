import type { RepoFacts, Sha } from "../../core/facts/facts.types.js";
import { readEnvMissing } from "../../core/facts/read-env-missing.js";
import { readRemovalFacts } from "../../core/facts/read-removal-facts.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { GitError } from "../../core/git/git.error.js";
import { observe } from "../../core/journal/observe.js";
import { openStore } from "../../core/journal/open-store.js";
import type { JournalEntry } from "../../core/journal/store.types.js";
import { evaluate } from "../../core/rules/evaluate.js";
import { safeToRemove } from "../../core/rules/safe-to-remove.js";
import type { Verdict } from "../../core/rules/verdict.types.js";
import { isMerged } from "../../core/stacks/is-merged.js";
import { readStackFacts } from "../../core/stacks/read-stack-facts.js";
import type { CliIo } from "../cli-io.types.js";
import { renderStatus } from "../render-status.js";

async function landed(facts: RepoFacts, sha: Sha): Promise<boolean> {
  try {
    return await isMerged(facts.root, sha, facts.trunk.ref);
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}

async function verdictFor(facts: RepoFacts, path: string): Promise<Verdict> {
  try {
    return safeToRemove(await readRemovalFacts(facts.root, path, facts));
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return { ok: false, reasons: [{ code: "unreadable", detail: "could not read this worktree", paths: [] }] };
  }
}

async function mergedRemovals(facts: RepoFacts): Promise<Map<string, Verdict>> {
  const removals = new Map<string, Verdict>();
  for (const worktree of facts.worktrees) {
    const branch = facts.branches.find((candidate) => candidate.name === worktree.branch);
    if (worktree.isMain || branch === undefined || !(await landed(facts, branch.tip))) continue;
    removals.set(worktree.path, await verdictFor(facts, worktree.path));
  }
  return removals;
}

/** Drops entries whose branch still exists with both its current tip and the tip it lost already in the trunk. */
async function stillUnresolved(facts: RepoFacts, entries: JournalEntry[]): Promise<JournalEntry[]> {
  const kept: JournalEntry[] = [];
  for (const entry of entries) {
    const branch = facts.branches.find((candidate) => candidate.name === entry.branch);
    const resolved = branch !== undefined && (await landed(facts, branch.tip)) && (await landed(facts, entry.oldTip));
    if (!resolved) kept.push(entry);
  }
  return kept;
}

/**
 * Runs `git grove status`: journals tip changes since the last run, reads the repository, stacks,
 * removal verdicts of merged worktrees and missing env files, evaluates the rules and prints the result.
 * With `json` it prints one JSON document `{ repo, trunk, features, findings, journal }` and nothing else.
 */
export async function statusCommand(io: CliIo, options: { json: boolean }): Promise<number> {
  const now = Date.now();
  const store = openStore();
  try {
    await observe(io.cwd, store, now);
    const facts = await readRepoFacts(io.cwd);
    const features = await readStackFacts(facts.root, facts);
    const removals = await mergedRemovals(facts);
    const envMissing = await readEnvMissing(facts.root, facts);
    const repoId = store.repoId(facts.commonDir, facts.root);
    const journal = await stillUnresolved(facts, store.entries(repoId, { unresolved: true }));
    const findings = evaluate({ facts, features, unresolved: journal, removals, envMissing, now });
    if (options.json) {
      const doc = { repo: { root: facts.root, commonDir: facts.commonDir }, trunk: facts.trunk, features, findings, journal };
      io.out(`${JSON.stringify(doc, null, 2)}\n`);
    } else {
      io.out(renderStatus({ facts, features, findings, removals, now, elapsedMs: Date.now() - now }));
    }
    return 0;
  } finally {
    store.close();
  }
}
