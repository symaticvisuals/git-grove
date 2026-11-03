export type GuardHookGroup = { matcher: "Bash"; hooks: [{ type: "command"; command: string; timeout: number }] };

/** A SessionStart group with no matcher, so it runs for startup, resume, clear, compact and fork. */
export type GuardAnnounceGroup = { hooks: [{ type: "command"; command: string; timeout: number }] };

const HOOK_TIMEOUT_S = 10;

/** The `PreToolUse` group that runs `command` before each Bash command, with a 10 s timeout. */
export function guardHookGroup(command: string): GuardHookGroup {
  return { matcher: "Bash", hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] };
}

/** The `SessionStart` group that tells a new session this agent is bounded by the guard. */
export function guardAnnounceGroup(command: string): GuardAnnounceGroup {
  return { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] };
}
