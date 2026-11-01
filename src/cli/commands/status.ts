import { realpath } from "node:fs/promises";
import { countDetachedOnly } from "../../core/facts/count-detached-only.js";
import type { RepoFacts } from "../../core/facts/facts.types.js";
import { readEnvMissing } from "../../core/facts/read-env-missing.js";
import { readRemovalFacts } from "../../core/facts/read-removal-facts.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { GitError } from "../../core/git/git.error.js";
import { isAncestor } from "../../core/git/is-ancestor.js";
import { unlessGitFails } from "../../core/git/unless-git-fails.js";
import { observe } from "../../core/journal/observe.js";
import { openStore } from "../../core/journal/open-store.js";
import type { JournalEntry, Store } from "../../core/journal/store.types.js";
import { evaluate } from "../../core/rules/evaluate.js";
import { safeToRemove } from "../../core/rules/safe-to-remove.js";
import type { Verdict } from "../../core/rules/verdict.types.js";
import { branchLanded } from "../../core/stacks/branch-landed.js";
import { readStackFacts } from "../../core/stacks/read-stack-facts.js";
import type { CliIo } from "../cli-io.types.js";
import { renderStatus } from "../render-status.js";

async function verdictFor(facts: RepoFacts, path: string): Promise<Verdict> {
  try {
    return safeToRemove(await readRemovalFacts(facts.root, path, facts));
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return { ok: false, reasons: [{ code: "unreadable", detail: "could not read this worktree", paths: [] }] };
  }
}

/** Verdicts for the linked worktrees, off the trunk, whose branch has landed on it. */
async function mergedRemovals(facts: RepoFacts): Promise<Map<string, Verdict>> {
  const removals = new Map<string, Verdict>();
  for (const worktree of facts.worktrees) {
    const branch = facts.branches.find((candidate) => candidate.name === worktree.branch);
    if (worktree.isMain || branch === undefined || branch.name === facts.trunk.name) continue;
    if (!(await branchLanded(facts.root, branch, facts.trunk.ref))) continue;
    removals.set(worktree.path, await verdictFor(facts, worktree.path));
  }
  return removals;
}

/** Commits only the detached HEAD of each prunable worktree holds; null for a worktree git fails to count. */
async function strandedCommits(facts: RepoFacts): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>();
  for (const worktree of facts.worktrees) {
    if (!worktree.prunable || worktree.branch !== null || worktree.head === null) continue;
    counts.set(worktree.path, await unlessGitFails(countDetachedOnly(facts.root, worktree.head), null));
  }
  return counts;
}

/**
 * Keeps the entries whose lost commits are neither back on their branch nor landed on the trunk.
 * A `deleted` entry, or one whose branch is gone, resolves once its lost tip lands;
 * one whose branch still exists also needs the branch's current tip landed.
 * An entry resolved by landing is acked in `store`, so it stays resolved however the trunk moves on.
 */
async function stillUnresolved(store: Store, repoId: number, facts: RepoFacts, now: number): Promise<JournalEntry[]> {
  const kept: JournalEntry[] = [];
  const trunkRef = facts.trunk.ref;
  for (const entry of store.entries(repoId, { unresolved: true })) {
    const branch = facts.branches.find((candidate) => candidate.name === entry.branch);
    if (branch !== undefined && (await unlessGitFails(isAncestor(facts.root, entry.oldTip, branch.tip), false))) continue;
    const resolved =
      (await branchLanded(facts.root, { name: entry.branch, tip: entry.oldTip }, trunkRef)) &&
      (entry.kind === "deleted" || branch === undefined || (await branchLanded(facts.root, branch, trunkRef)));
    if (!resolved) kept.push(entry);
    else if (entry.id !== undefined) store.ack(repoId, entry.id, now);
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
    const envMissing = await readEnvMissing(facts.root, facts).catch(() => new Map<string, string[]>());
    const detachedOnly = await strandedCommits(facts);
    const repoId = store.repoId(facts.commonDir, facts.root);
    const journal = await stillUnresolved(store, repoId, facts, now);
    const findings = evaluate({ facts, features, unresolved: journal, removals, envMissing, detachedOnly, now });
    if (options.json) {
      const doc = { repo: { root: facts.root, commonDir: facts.commonDir }, trunk: facts.trunk, features, findings, journal };
      io.out(`${JSON.stringify(doc, null, 2)}\n`);
    } else {
      const cwd = await realpath(io.cwd).catch(() => io.cwd);
      io.out(renderStatus({ facts, features, findings, removals, cwd, now, elapsedMs: Date.now() - now }));
    }
    return 0;
  } finally {
    store.close();
  }
}
