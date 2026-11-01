import { existsSync } from "node:fs";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import type { ExecuteResult, RunContext } from "../action.types.js";
import { errorLine } from "../error-line.js";
import { copiedLine } from "./copied-line.js";
import { removalReasons } from "./removal-reasons.js";
import type { RemoveRead } from "./remove-plan.js";
import { removeWorktreeSafely } from "./remove-worktree-safely.js";
import { rescueFiles } from "./rescue-files.js";
import { verifyCopies, type RescuedFile } from "./verify-copies.js";

/**
 * Runs a remove plan from `run.firstStep`: copies each precious file to main, checks every copy byte for byte,
 * re-reads the full verdict with the copied files counted as kept, then removes the folder without `--force`, the
 * verdict read once more right before. Any copy that fails or differs, and any new reason to keep the worktree, stops
 * the run before anything is removed; the receipt lists every file already copied. The branch is never touched.
 */
export async function runRemove(read: RemoveRead, run: RunContext): Promise<ExecuteResult> {
  const { root } = run.facts;
  const { worktree, shown } = read.removal;
  const copies = read.rescue ? read.removal.copies : [];
  const copied: RescuedFile[] = [];
  const kept = worktree.branch === null ? [] : [`The branch ${worktree.branch} is kept`];
  const held: { reasons: string[] } = { reasons: [] };
  const stopped = (error: unknown): ExecuteResult => ({
    ok: false,
    title: `Stopped before removing ${shown}`,
    lines: [
      ...copied.map(copiedLine),
      ...(held.reasons.length > 0 ? held.reasons : [errorLine(error)]),
      `${shown} was not removed`,
      ...kept,
    ],
    undo: null,
  });
  const rescued = (): Set<string> => new Set(copied.map((copy) => copy.from));

  let index = run.firstStep;
  let removing = false;
  try {
    for (const { from } of copies) {
      await run.step(index++, async () => {
        const done = await rescueFiles(root, worktree.path, [from]);
        copied.push(...done);
        return done.map((copy) => (copy.to === copy.from ? "copied" : `copied as ${copy.to}`)).join("; ");
      });
    }
    if (copies.length > 0) {
      await run.step(index++, async () => {
        await verifyCopies(root, worktree.path, copied);
        return "identical";
      });
    }
    await run.step(index++, async () => {
      held.reasons = await removalReasons(await readRepoFacts(root), worktree.path, rescued());
      if (held.reasons.length > 0) throw new Error(held.reasons.join("; "));
      return "nothing else only here";
    });
    removing = true;
    await run.step(index, async () => {
      const result = await removeWorktreeSafely(root, worktree.path, rescued());
      if (!result.removed) {
        held.reasons = result.reasons;
        throw new Error(result.reasons.join("; "));
      }
      return shown;
    });
  } catch (error) {
    if (!removing || held.reasons.length > 0) return stopped(error);
    const left = existsSync(worktree.path) ? `${shown} is still there` : `${shown} is gone`;
    return {
      ok: false,
      title: `Stopped: could not remove ${shown}`,
      lines: [...copied.map(copiedLine), errorLine(error), left, ...kept],
      undo: null,
    };
  }
  return { ok: true, title: `Cleaned up ${shown}`, lines: [...copied.map(copiedLine), `Removed ${shown}`, ...kept], undo: null };
}
