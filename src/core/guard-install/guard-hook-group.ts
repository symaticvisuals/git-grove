export type GuardHookGroup = { matcher: "Bash"; hooks: [{ type: "command"; command: string; timeout: number }] };

const HOOK_TIMEOUT_S = 10;

/** The `PreToolUse` group that runs `command` before each Bash command, with a 10 s timeout. */
export function guardHookGroup(command: string): GuardHookGroup {
  return { matcher: "Bash", hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] };
}
