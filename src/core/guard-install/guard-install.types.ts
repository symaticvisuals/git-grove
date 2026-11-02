/** What a review of Claude Code's settings asks for: add grove's hook, or take it out. */
export type GuardChange = "install" | "uninstall";

/**
 * Where the agent guard stands in a settings file: `absent` (no file, or no grove hook in it), `installed` (one grove
 * hook, running the wanted command), `stale` (a grove hook running another command, or more than one), or
 * `unreadable` (grove cannot read the file, or will not edit it).
 */
export type GuardStatus = "absent" | "installed" | "stale" | "unreadable";

/**
 * A settings file as read: its bytes and text, null when there is none, its SHA-256 (`missing` for none), why it could
 * not be read, and whether it is read-only, which grove leaves alone.
 */
export type SettingsFile = { path: string; text: string | null; bytes: Uint8Array | null; hash: string; problem: string | null; readOnly: boolean };

/** The status of grove's hook in a settings file, whether that file turns every hook off, and why it is unreadable. */
export type GuardReading = { status: GuardStatus; hooksDisabled: boolean; problem: string | null };

/** What the dashboard shows of the guard: where it stands, the settings file, the command grove wants, and why grove would refuse. */
export type GuardState = {
  status: GuardStatus;
  settingsPath: string;
  command: string;
  hooksDisabled: boolean;
  refusal: string | null;
};

/**
 * A change to Claude Code's settings, shown before it is made. `adds` and `removes` are the JSON it adds and takes
 * out; `backupPath` is null when the file does not exist yet. `lines` say what else is true, `warnings` what stops
 * the hook from running even once it is in, and `blockers` why the change cannot be made; a plan with blockers runs
 * nothing.
 */
export type GuardPlan = {
  change: GuardChange;
  title: string;
  summary: string;
  confirm: string;
  settingsPath: string;
  backupPath: string | null;
  adds: string | null;
  removes: string[];
  lines: string[];
  warnings: string[];
  blockers: string[];
  readAt: number;
};

/** The write a plan makes: the new text for `path`, made only while the file still hashes to `saw`. */
export type GuardEdit = { path: string; saw: string; text: string };

/** A reviewed change: its plan, the edit it makes (null when it is blocked), the receipt's title once it is made, and whether it replaces an older grove hook. */
export type PreparedGuardChange = { plan: GuardPlan; edit: GuardEdit | null; done: string; updated: boolean };

/**
 * What a change did. `undo` is the change offered after it, for review; null when nothing changed. After an install
 * that `updated` an older grove hook it is an uninstall, which does not bring the old hook back.
 */
export type GuardReceipt = {
  change: GuardChange;
  updated: boolean;
  ok: boolean;
  refused: boolean;
  title: string;
  lines: string[];
  undo: GuardChange | null;
  at: number;
};
