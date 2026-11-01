import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { plural } from "../../rules/plural.js";
import type { ExecuteResult, RunContext } from "../action.types.js";
import { checkExpectations } from "../check-expectations.js";
import { errorLine } from "../error-line.js";
import { copiedLine } from "./copied-line.js";
import type { Removal } from "./read-removal.js";
import { removalReasons } from "./removal-reasons.js";
import { removeWorktreeSafely } from "./remove-worktree-safely.js";
import { rescueFiles } from "./rescue-files.js";
import { verifyCopies, type RescuedFile } from "./verify-copies.js";

type Outcome = { removal: Removal; copied: RescuedFile[]; state: "removed" | "skipped" | "kept"; why: string };

async function recheck(root: string, removal: Removal): Promise<string[]> {
  try {
    const fresh = await readRepoFacts(root);
    const changed = await checkExpectations(fresh, removal.expects);
    if (changed.length > 0) return changed;
    return await removalReasons(fresh, removal.worktree.path, new Set(removal.copies.map((copy) => copy.from)));
  } catch (error) {
    return [errorLine(error)];
  }
}

function outcomeLine({ removal, state, why }: Outcome): string {
  if (state === "removed") return `Removed ${removal.shown}`;
  return state === "skipped" ? `Skipped ${removal.shown}: ${why}` : `${removal.shown} was not removed: ${why}`;
}

async function cleanOne(root: string, removal: Removal, first: number, run: RunContext): Promise<Outcome> {
  const { worktree, copies } = removal;
  const copied: RescuedFile[] = [];
  const last = first + copies.length;
  const skipFrom = (index: number, why: string): void => {
    for (let at = index; at <= last; at++) run.skip(at, why);
  };

  const reasons = await recheck(root, removal);
  if (reasons.length > 0) {
    const why = reasons.join("; ");
    skipFrom(first, why);
    return { removal, copied, state: "skipped", why };
  }
  for (const [offset, { from }] of copies.entries()) {
    try {
      await run.step(first + offset, async () => {
        const done = await rescueFiles(root, worktree.path, [from]);
        copied.push(...done);
        return done.map((copy) => (copy.to === copy.from ? "copied" : `copied as ${copy.to}`)).join("; ");
      });
    } catch (error) {
      skipFrom(first + offset + 1, "A copy failed, so the folder stays");
      return { removal, copied, state: "kept", why: errorLine(error) };
    }
  }
  try {
    await run.step(last, async () => {
      await verifyCopies(root, worktree.path, copied);
      const result = await removeWorktreeSafely(root, worktree.path, new Set(copied.map((copy) => copy.from)));
      if (!result.removed) throw new Error(result.reasons.join("; "));
      return worktree.branch === null ? "removed" : "branch kept";
    });
  } catch (error) {
    return { removal, copied, state: "kept", why: errorLine(error) };
  }
  return { removal, copied, state: "removed", why: "" };
}

/**
 * Runs a clean up plan from `run.firstStep`, one picked worktree after another. Before a worktree's first step it is
 * checked against what the plan read (its head, tip, uncommitted paths and operation) and its full verdict is re-read:
 * any change, or any reason beyond the precious files the plan copies, skips all of its steps. Its files are
 * then copied to main and checked, and the folder is removed only if the verdict, read once more, is still clear.
 * A worktree that is skipped or fails stays, and the run carries on with the next; the receipt names each one.
 */
export async function runCleanup(picked: Removal[], run: RunContext): Promise<ExecuteResult> {
  const outcomes: Outcome[] = [];
  let first = run.firstStep;
  for (const removal of picked) {
    outcomes.push(await cleanOne(run.facts.root, removal, first, run));
    first += removal.copies.length + 1;
  }
  const removed = outcomes.filter((outcome) => outcome.state === "removed").length;
  const lines = outcomes.flatMap((outcome) => [...outcome.copied.map(copiedLine), outcomeLine(outcome)]);
  const ok = removed === outcomes.length;
  return {
    ok,
    title: ok ? `Cleaned up ${plural(removed, "worktree")}` : `Cleaned up ${removed} of ${plural(outcomes.length, "worktree")}`,
    lines: [...lines, "Every branch is kept"],
    undo: null,
  };
}
