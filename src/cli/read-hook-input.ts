/** The fields of a Claude Code `PreToolUse` hook's stdin that the guard reads; every other field is ignored. */
export type HookInput = { toolName: string; command: string | null; cwd: string | null; sessionId: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Reads a `PreToolUse` hook's JSON: `tool_name`, `tool_input.command`, `cwd` and `session_id`. Returns null for text
 * that is not JSON or is no object with a string `tool_name`; a missing command is null, not an error.
 */
export function readHookInput(text: string): HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const toolName = value["tool_name"];
  if (typeof toolName !== "string") return null;
  const toolInput = value["tool_input"];
  return {
    toolName,
    command: isRecord(toolInput) ? stringOrNull(toolInput["command"]) : null,
    cwd: stringOrNull(value["cwd"]),
    sessionId: stringOrNull(value["session_id"]),
  };
}
