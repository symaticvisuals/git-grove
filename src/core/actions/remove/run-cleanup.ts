import { plural } from "../../rules/plural.js";
import type { ExecuteResult, RunContext } from "../action.types.js";
import { errorLine } from "../error-line.js";
import { copiedLine } from "./copied-line.js";
import type { Removal } from "./read-removal.js";
import { removalReasons } from "./removal-reasons.js";
import { removeWorktreeSafely } from "./remove-worktree-safely.js";
import { rescueFiles } from "./rescue-files.js";
import { verifyCopies, type RescuedFile } from "./verify-copies.js";

type Outcome = { removal: Removal; copied: RescuedFile[]; why: string | null };

async function cleanOne(root: string, removal: Removal, first: number, run: RunContext): Promise<Outcome> {
  const { worktree, copies } = removal;
  const copied: RescuedFile[] = [];
  const last = first + copies.length;
  const skipFrom = (index: number, why: string): void => {
    for (let at = index; at <= last; at++) run.skip(at, why);
  };

  const planned = new Set(copies.map((copy) => copy.from));
  const reasons = await removalReasons(root, worktree.path, planned).catch((error: unknown) => [errorLine(error)]);
  if (reasons.length > 0) {
    const why = reasons.join("; ");
    skipFrom(first, why);
    return { removal, copied, why };
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
      return { removal, copied, why: errorLine(error) };
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
    return { removal, copied, why: errorLine(error) };
  }
  return { removal, copied, why: null };
}

/**
 * Runs a clean up plan from `run.firstStep`, one picked worktree after another. Before a worktree's first step its
 * full verdict is re-read: any reason beyond the precious files the plan copies skips all of its steps. Its files are
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
  const removed = outcomes.filter((outcome) => outcome.why === null).length;
  const lines = outcomes.flatMap(({ removal, copied, why }) => [
    ...copied.map(copiedLine),
    why === null ? `Removed ${removal.shown}` : `${removal.shown} was not removed: ${why}`,
  ]);
  const ok = removed === outcomes.length;
  return {
    ok,
    title: ok ? `Cleaned up ${plural(removed, "worktree")}` : `Cleaned up ${removed} of ${plural(outcomes.length, "worktree")}`,
    lines: [...lines, "Every branch is kept"],
    undo: null,
  };
}
