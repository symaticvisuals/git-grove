import { resolveCommit } from "../git/resolve-commit.js";
import type { GuardCheck } from "./guard-check.types.js";

/**
 * Sorts a `git checkout` with operands and no `--` the way git does: a first operand that names a commit, with more
 * after it, is the tree the rest are restored from (a discard of staged and unstaged changes); a lone commit is a
 * switch, which git refuses when it would clobber changes (null); anything else is a list of paths restored from the
 * index (a discard of unstaged changes). One `git rev-parse` call.
 */
export async function readCheckoutOperands(check: GuardCheck & { kind: "checkout-operands" }): Promise<(GuardCheck & { kind: "discard" }) | null> {
  const [first, ...rest] = check.operands;
  const commit = first === undefined ? null : await resolveCommit(check.cwd, first);
  if (commit !== null && rest.length === 0) return null;
  const fromTree = commit !== null;
  return {
    kind: "discard",
    cwd: check.cwd,
    verb: check.verb,
    text: check.text,
    side: fromTree ? "all" : "unstaged",
    scope: "paths",
    pathspecs: fromTree ? rest : check.operands,
    moveTo: null,
  };
}
