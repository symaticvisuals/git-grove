import { sep } from "node:path";
import { shellWord } from "../actions/shell-word.js";
import { resolveCommit } from "../git/resolve-commit.js";
import { runGit } from "../git/run-git.js";
import { plural } from "../rules/plural.js";
import type { GuardCheck } from "./guard-check.types.js";
import type { GuardBlock, PendingPin } from "./guard-decision.types.js";
import { readOperation } from "./read-operation.js";
import { readWorktreeHead } from "./read-worktree-head.js";
import { shownPath } from "./shown-path.js";

/** A discard's block, or the tip to pin when it allows a reset that moves the branch. */
export type DiscardJudgement = { block: GuardBlock | null; pins: PendingPin[] };

type Discard = GuardCheck & { kind: "discard" };

function discardable(check: Discard, line: string): boolean {
  if (line.startsWith("u ")) return check.scope === "tree";
  return /^[12] /.test(line) && (check.side === "all" || line[3] !== ".");
}

async function countChanges(check: Discard): Promise<number> {
  const pathspecs = check.pathspecs.length > 0 ? ["--", ...check.pathspecs] : [];
  const { stdout } = await runGit(["status", "--porcelain=v2", "--untracked-files=no", "--ignore-submodules=all", ...pathspecs], { cwd: check.cwd });
  return stdout.split("\n").filter((line) => discardable(check, line)).length;
}

async function advice(check: Discard): Promise<string> {
  const operation = await readOperation(check.cwd);
  if (operation !== null && check.scope === "tree") {
    return `A ${operation.name} is in progress. To drop it and keep your own uncommitted changes, run: ${operation.abort}`;
  }
  if (operation !== null) {
    return `A ${operation.name} is in progress. Name only the conflicted paths, which git diff --name-only --diff-filter=U lists, or leave the other files alone and tell the user.`;
  }
  if (check.scope === "tree") return "Commit them, or run git stash on its own first, then retry.";
  const paths = check.pathspecs.length > 0 ? ` -- ${check.pathspecs.map(shellWord).join(" ")}` : " with the same paths";
  return `To keep a copy, run git stash push${paths} on its own first, then retry.`;
}

/**
 * Blocks a command that would discard uncommitted changes (`git status --porcelain=v2 --untracked-files=no
 * --ignore-submodules=all`, limited to its pathspecs, and to unstaged changes when it leaves the index alone).
 * Unmerged paths count only for a discard of the whole tree, since git's conflict tools rewrite them from the index.
 * During a rebase, merge, cherry-pick or revert, the advice names its abort for a whole-tree discard and the conflicted
 * paths for a path discard, where a stash would fail; otherwise a path stash for a path discard, and a commit or a stash
 * run on its own for the tree. An allowed `reset --hard <rev>` that moves a branch pins its tip.
 */
export async function judgeDiscard(check: Discard, from: string): Promise<DiscardJudgement> {
  const head = await readWorktreeHead(check.cwd);
  const subject = { commonDir: head.commonDir, root: head.root, worktree: head.top, branch: head.branch };
  const changes = await countChanges(check);
  if (changes > 0) {
    const inside = from === head.top || from.startsWith(head.top + sep);
    const where = inside ? "this worktree" : shownPath(from, head.top);
    const message = `git grove blocked: ${where} has ${plural(changes, "uncommitted change")} that ${check.text} would discard. ${await advice(check)}`;
    return { block: { message, verb: check.verb, subject }, pins: [] };
  }
  if (check.moveTo === null || head.branch === null || head.sha === null) return { block: null, pins: [] };
  const target = await resolveCommit(check.cwd, check.moveTo);
  if (target === null || target === head.sha) return { block: null, pins: [] };
  return { block: null, pins: [{ cwd: check.cwd, subject, verb: check.verb, branch: head.branch, sha: head.sha }] };
}
