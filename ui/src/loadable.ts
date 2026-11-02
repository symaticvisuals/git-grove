import type { SliceName } from "./slice-names.js";
import type { State } from "./state.js";

/**
 * Whether `slice` should be fetched now: it is loading, or loaded and stale. The detail panel's preview waits while
 * a dialog is open, so a burst of digests cannot push the dialog's own plan out of git grove's plan cache.
 */
export function loadable(state: State, slice: SliceName): boolean {
  const current = state[slice];
  if (current === null || !(current.status === "loading" || (current.status === "ready" && current.stale))) return false;
  return !(slice === "preview" && state.dialog !== null);
}
