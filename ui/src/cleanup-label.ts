import type { WireRepoView } from "../../src/server/wire/wire.types.js";
import { plural } from "./plural.js";

/**
 * What the cleanup chip says: "2 worktrees safe to clean up", "1 worktree to clean up, needs a rescue", or
 * "3 worktrees to clean up, 1 needs a rescue". Null when clean up has nothing to offer.
 */
export function cleanupLabel(view: Pick<WireRepoView, "cleanupCount" | "rescueCount">): string | null {
  const { cleanupCount: safe, rescueCount: rescue } = view;
  if (safe + rescue === 0) return null;
  if (rescue === 0) return `${plural(safe, "worktree")} safe to clean up`;
  const need = rescue === 1 ? "needs" : "need";
  return safe === 0 ? `${plural(rescue, "worktree")} to clean up, ${need} a rescue` : `${plural(safe + rescue, "worktree")} to clean up, ${rescue} ${need} a rescue`;
}
