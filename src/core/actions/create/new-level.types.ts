import type { Sha } from "../../facts/facts.types.js";

/**
 * A level to create, as its plan read it. `parent` is the branch it forks from and `forkPoint` that branch's tip;
 * `depth` is its two-digit number. `grovefeature` is recorded only with `recordFeature`. `envFiles` are relative to
 * the main worktree `mainPath`; `install` is the command to run in the new folder, or null; `ignoreWorktrees` is
 * whether `.worktrees/` must be added to the clone's `info/exclude`.
 */
export type NewLevel = {
  feature: string;
  branch: string;
  parent: string;
  forkPoint: Sha;
  depth: number;
  folder: string;
  mainPath: string;
  recordFeature: boolean;
  ignoreWorktrees: boolean;
  envFiles: string[];
  install: { argv: string[]; label: string } | null;
  installHint: string | null;
  open: boolean;
};
