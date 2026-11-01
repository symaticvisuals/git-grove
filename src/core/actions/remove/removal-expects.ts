import type { RepoFacts } from "../../facts/facts.types.js";
import type { Expectation } from "../plan.types.js";
import type { Removal } from "./read-removal.js";

/** What a removal plan relies on: the worktree as read, uncommitted paths included, and its branch's tip. */
export function removalExpects(facts: RepoFacts, removal: Removal): Expectation[] {
  const { path, head, operation, branch } = removal.worktree;
  const expects: Expectation[] = [{ kind: "worktree", path, head, dirty: removal.dirty, operation }];
  const tip = facts.branches.find((candidate) => candidate.name === branch)?.tip;
  if (branch !== null && tip !== undefined) expects.push({ kind: "tip", branch, sha: tip });
  return expects;
}
