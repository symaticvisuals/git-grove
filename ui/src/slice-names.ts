/** The parts of the state that are loaded from git grove, each on its own. */
export const SLICE_NAMES = ["projects", "repo", "feature", "preview", "activity", "pins", "needs", "guard"] as const;

export type SliceName = (typeof SLICE_NAMES)[number];
