import { join } from "node:path";
import { sameBytes } from "../../facts/same-bytes.js";
import { RescueFailedError } from "./rescue-failed.error.js";

/** A file copied out of a worktree: `from` relative to the worktree, `to` relative to the main worktree. */
export type RescuedFile = { from: string; to: string };

/** Throws RescueFailedError for the first copy whose bytes no longer match the worktree's file. */
export async function verifyCopies(main: string, worktree: string, copies: readonly RescuedFile[]): Promise<void> {
  for (const { from, to } of copies) {
    if (!(await sameBytes(join(worktree, from), join(main, to)))) {
      throw new RescueFailedError(from, `the copy at ${to} in main does not match`);
    }
  }
}
