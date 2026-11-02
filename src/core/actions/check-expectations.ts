import { existsSync } from "node:fs";
import type { RepoFacts, Sha } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";
import { displayPath } from "./display-path.js";
import type { Expectation } from "./plan.types.js";
import { readDirtyPaths } from "./read-dirty-paths.js";

function short(sha: Sha | null): string {
  return sha === null ? "nothing" : sha.slice(0, 7);
}

async function commitOf(root: string, ref: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Compares the repository with what a plan read and returns one line per difference, such as
 * `feat moved: was f01aa41, now 9c2e0b1`, `refs/grove/pins/feat/… no longer points at f01aa41`,
 * `src/x.ts changed in .worktrees/a` or `.worktrees/b now exists`.
 * A worktree whose head moved with a branch already reported is not reported again.
 */
export async function checkExpectations(facts: RepoFacts, expects: Expectation[]): Promise<string[]> {
  const tips = new Map(facts.branches.map((branch) => [branch.name, branch.tip]));
  const reported = new Set<Sha>();
  for (const expect of expects) {
    const now = expect.kind === "tip" ? (tips.get(expect.branch) ?? null) : null;
    if (expect.kind === "tip" && now !== null && now !== expect.sha) reported.add(now);
  }

  const lines: string[] = [];
  for (const expect of expects) {
    if (expect.kind === "tip") {
      const now = tips.get(expect.branch) ?? null;
      if (now === expect.sha) continue;
      if (expect.sha === null) lines.push(`${expect.branch} now exists`);
      else if (now === null) lines.push(`${expect.branch} was deleted`);
      else lines.push(`${expect.branch} moved: was ${short(expect.sha)}, now ${short(now)}`);
      continue;
    }

    if (expect.kind === "ref") {
      if ((await commitOf(facts.root, expect.ref)) !== expect.sha) lines.push(`${expect.ref} no longer points at ${short(expect.sha)}`);
      continue;
    }

    const shown = displayPath(facts.root, expect.path);
    if (expect.kind === "absent") {
      if (existsSync(expect.path)) lines.push(`${shown} now exists`);
      continue;
    }

    const worktree = facts.worktrees.find((candidate) => candidate.path === expect.path && !candidate.prunable);
    if (worktree === undefined || !existsSync(expect.path)) {
      lines.push(`${shown} is gone`);
      continue;
    }
    if (worktree.head !== expect.head && !(worktree.head !== null && reported.has(worktree.head))) {
      lines.push(`${shown} moved: was ${short(expect.head)}, now ${short(worktree.head)}`);
    }
    if (worktree.operation !== expect.operation) {
      lines.push(
        worktree.operation === null
          ? `${shown} finished its ${expect.operation ?? "operation"}`
          : `${shown} has a ${worktree.operation} in progress`,
      );
    }
    const dirty = await readDirtyPaths(expect.path);
    const was = new Set(expect.dirty);
    const now = new Set(dirty);
    const changed = [...new Set([...expect.dirty, ...dirty])].filter((path) => was.has(path) !== now.has(path)).sort();
    for (const path of changed) lines.push(`${path} changed in ${shown}`);
  }
  return lines;
}
