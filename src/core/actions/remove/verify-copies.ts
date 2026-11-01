import { join } from "node:path";
import { fileDigest } from "../../facts/file-digest.js";
import { readLinkedRoots } from "../../facts/read-linked-roots.js";
import { resolvesOutside } from "../../facts/resolves-outside.js";
import { RescueFailedError } from "./rescue-failed.error.js";

/** A file to copy out of a worktree: `from` relative to the worktree, `to` relative to the main worktree. */
export type RescuedFile = { from: string; to: string };

/** A file copied out of a worktree, with the SHA-256 both sides had when the copy was made. */
export type CopiedFile = RescuedFile & { digest: string };

/**
 * Throws RescueFailedError for the first copy that no longer holds: main's copy is gone, changed, or now reached
 * through a path into a linked worktree; or the worktree's file changed since. The reason says which side moved.
 */
export async function verifyCopies(main: string, worktree: string, copies: readonly CopiedFile[]): Promise<void> {
  if (copies.length === 0) return;
  const roots = await readLinkedRoots(main);
  for (const { from, to, digest } of copies) {
    const kept = (await resolvesOutside(join(main, to), roots)) ? await fileDigest(join(main, to)) : null;
    if (kept !== digest) throw new RescueFailedError(from, `the copy of ${from} in main changed after it was made`);
    if ((await fileDigest(join(worktree, from))) !== digest) {
      throw new RescueFailedError(from, `${from} changed after it was copied, so its copy in main no longer matches`);
    }
  }
}
