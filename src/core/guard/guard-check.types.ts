import type { ShellWord } from "./shell-line.types.js";

/**
 * A tip to pin before a command runs: the checked-out branch's, a named branch's, or a force push's. A push's
 * `source` null is the checked-out branch, `remote` null its push remote, and `destination` null the source's own name.
 */
export type PinRequest =
  | { kind: "head" }
  | { kind: "branch"; name: string }
  | { kind: "push"; source: string | null; remote: string | null; destination: string | null };

/** Which uncommitted changes a command would discard: unstaged ones only, or staged ones too. */
export type DiscardSide = "unstaged" | "all";

/** Whether a discard rewrites only the paths it names, or the whole tree (where unmerged paths count too). */
export type DiscardScope = "paths" | "tree";

/**
 * What the guard has to check before one simple command runs. `text` is the command as shown in messages and
 * `verb` its short name in activity; `cwd` is the folder git or rm runs in.
 */
export type GuardCheck =
  | { kind: "none" }
  | { kind: "unchecked" }
  | { kind: "people-only"; cwd: string | null; verb: string; message: string }
  | { kind: "worktree-remove"; cwd: string; verb: string; text: string; target: string }
  | { kind: "recursive-rm"; cwd: string; verb: string; text: string; paths: ShellWord[] }
  | { kind: "discard"; cwd: string; verb: string; text: string; side: DiscardSide; scope: DiscardScope; pathspecs: string[]; moveTo: string | null }
  | { kind: "pin"; cwd: string; verb: string; text: string; pins: PinRequest[] };
