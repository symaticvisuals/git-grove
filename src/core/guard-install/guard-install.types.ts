/** What a review of Claude Code's settings asks for: taking grove's old hook out. The guard installs as a plugin instead. */
export type GuardChange = "uninstall";

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

/**
 * Which guard Claude Code runs: `plugin` (grove's plugin alone), `plugin-and-hook` (the plugin and the old hook in
 * settings), `hook` (the old hook alone), or `absent` (neither).
 */
export type GuardPhase = "plugin" | "plugin-and-hook" | "hook" | "absent";

/** The status of grove's hook in a settings file, whether the plugin is enabled there, whether that file turns every hook off, and why it is unreadable. */
export type GuardReading = { status: GuardStatus; pluginEnabled: boolean; hooksDisabled: boolean; problem: string | null };

/**
 * What the dashboard shows of the guard: where the old hook stands, the settings file, the command grove wants, and why
 * grove would refuse. `plugin` is whether the plugin is enabled, `hookCommand` whether the plugin's `hook-command` record
 * is usable, `ephemeral` whether this grove runs from a package runner's cache, `phase` which guard runs, `done` whether
 * the guard is really on, and `installCommands` what installs the plugin.
 */
export type GuardState = {
  status: GuardStatus;
  plugin: boolean;
  hookCommand: boolean;
  ephemeral: boolean;
  phase: GuardPhase;
  done: boolean;
  installCommands: string[];
  settingsPath: string;
  command: string;
  hooksDisabled: boolean;
  refusal: string | null;
};

/**
 * A change to Claude Code's settings, shown before it is made. `removes` is the JSON it takes out; `adds` is null,
 * since grove only removes its old hook. `backupPath` is null when the file does not exist yet. `lines` say what else is true, `warnings` what the
 * change cannot fix, and `blockers` why the change cannot be made; a plan with blockers runs nothing.
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

/** A reviewed change: its plan, the edit it makes (null when it is blocked), and the receipt's title once it is made. */
export type PreparedGuardChange = { plan: GuardPlan; edit: GuardEdit | null; done: string };

/** What a change did. `undo` is always null: grove no longer puts its hook back, the plugin replaces it. */
export type GuardReceipt = {
  change: GuardChange;
  ok: boolean;
  refused: boolean;
  title: string;
  lines: string[];
  undo: null;
  at: number;
};
