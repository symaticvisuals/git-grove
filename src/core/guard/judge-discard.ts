import { sep } from "node:path";
import { resolveCommit } from "../git/resolve-commit.js";
import { runGit } from "../git/run-git.js";
import { plural } from "../rules/plural.js";
import type { DiscardSide, GuardCheck } from "./guard-check.types.js";
import type { GuardBlock, PendingPin } from "./guard-decision.types.js";
import { readWorktreeHead } from "./read-worktree-head.js";
import { shownPath } from "./shown-path.js";

/** A discard's block, or the tip to pin when it allows a reset that moves the branch. */
export type DiscardJudgement = { block: GuardBlock | null; pins: PendingPin[] };

async function countChanges(cwd: string, side: DiscardSide, pathspecs: readonly string[]): Promise<number> {
  const args = ["status", "--porcelain=v2", "--untracked-files=no", "--ignore-submodules=none", ...(pathspecs.length > 0 ? ["--", ...pathspecs] : [])];
  const { stdout } = await runGit(args, { cwd });
  return stdout.split("\n").filter((line) => line.startsWith("u ") || (/^[12] /.test(line) && (side === "all" || line[3] !== "."))).length;
}

/**
 * Blocks a command that would discard uncommitted changes (`git status --porcelain=v2 --untracked-files=no`, limited
 * to its pathspecs and to unstaged changes when it leaves the index alone), unless `setAside` holds the worktree
 * because an earlier `git stash` in the line set them aside. An allowed `reset --hard <rev>` that moves a branch
 * pins the branch's current tip.
 */
export async function judgeDiscard(check: GuardCheck & { kind: "discard" }, from: string, setAside: ReadonlySet<string>): Promise<DiscardJudgement> {
  const head = await readWorktreeHead(check.cwd);
  const subject = { commonDir: head.commonDir, root: head.root, worktree: head.top, branch: head.branch };
  if (!setAside.has(head.top)) {
    const changes = await countChanges(check.cwd, check.side, check.pathspecs);
    if (changes > 0) {
      const inside = from === head.top || from.startsWith(head.top + sep);
      const where = inside ? "this worktree" : shownPath(from, head.top);
      const message = `git grove blocked: ${where} has ${plural(changes, "uncommitted change")} that ${check.text} would discard. Commit them, or set them aside with git stash first.`;
      return { block: { message, verb: check.verb, subject }, pins: [] };
    }
  }
  if (check.moveTo === null || head.branch === null || head.sha === null) return { block: null, pins: [] };
  const target = await resolveCommit(check.cwd, check.moveTo);
  if (target === null || target === head.sha) return { block: null, pins: [] };
  return { block: null, pins: [{ cwd: check.cwd, subject, verb: check.verb, branch: head.branch, sha: head.sha }] };
}
