import type { Operation, Sha } from "../facts/facts.types.js";

export type ActionName = "restore" | "ack" | "restack" | "new" | "add-level" | "copy-env" | "remove" | "cleanup";

export type Check = { ok: boolean; text: string; why: string | null };

export type LaneCommit = { sha: Sha; subject: string; tip: boolean; base: boolean; lost: boolean; pinned: boolean };

/** Oldest first, the base row first. */
export type Lane = { caption: string; commits: LaneCommit[] };

export type FolderLine = { path: string; isNew: boolean; note: string };

export type Choice = {
  id: string;
  label: string;
  detail: string;
  selectable: boolean;
  selected: boolean;
  health: "loses" | "fine" | "idle";
};

/** What a plan read and relies on. A `tip` with `sha` null expects the branch not to exist; a `ref` resolves to commit `sha`. */
export type Expectation =
  | { kind: "tip"; branch: string; sha: Sha | null }
  | { kind: "ref"; ref: string; sha: Sha }
  | { kind: "worktree"; path: string; head: Sha | null; dirty: string[]; operation: Operation | null }
  | { kind: "absent"; path: string };

/**
 * An action shown before it runs. `steps` start with "Check nothing moved since you looked", then "Pin …" when
 * `moves` is non-empty; `moves` names the branches the run pins before moving them. `readAt` is when its facts were read.
 */
export type Plan = {
  action: ActionName;
  context: string;
  title: string;
  summary: string;
  confirm: string;
  before: Lane | null;
  after: Lane | null;
  folders: FolderLine[] | null;
  choices: Choice[] | null;
  checks: Check[];
  effects: string[];
  commands: string[];
  steps: { title: string; detail: string }[];
  blockers: string[];
  note: string | null;
  undoable: boolean;
  moves: string[];
  expects: Expectation[];
  readAt: number;
};

export type StepEvent = { index: number; state: "running" | "done" | "failed" | "skipped"; detail: string; ms: number | null };

export type RestoreTarget = { branch: string; pinRef: string };

/** A pin a run took before moving a branch; `reused` when that pin already pointed at the tip before the run. */
export type ReceiptPin = { ref: string; reused: boolean };

export type Receipt = {
  action: ActionName;
  ok: boolean;
  refused: boolean;
  title: string;
  lines: string[];
  pins: ReceiptPin[];
  undo: RestoreTarget[] | null;
  at: number;
};
