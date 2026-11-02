import { isJsonObject } from "./is-json-object.js";

export type ParsedSettings = { ok: true; settings: Record<string, unknown> } | { ok: false; problem: string };

/**
 * Reads a settings file's text as strict JSON, the way Claude Code does. No file, or one holding only whitespace, is
 * `{}`. Anything else must be a JSON object whose `hooks`, when present, is an object and whose `hooks.PreToolUse`,
 * when present, is a list; otherwise `problem` says what is wrong, as a phrase that follows "It".
 */
export function parseClaudeSettings(text: string | null): ParsedSettings {
  if (text === null || text.trim() === "") return { ok: true, settings: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, problem: `is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!isJsonObject(value)) return { ok: false, problem: "is not a JSON object" };
  const hooks = value["hooks"];
  if (hooks !== undefined && !isJsonObject(hooks)) return { ok: false, problem: 'has a "hooks" that is not an object' };
  if (hooks !== undefined && hooks["PreToolUse"] !== undefined && !Array.isArray(hooks["PreToolUse"])) {
    return { ok: false, problem: 'has a "hooks.PreToolUse" that is not a list' };
  }
  return { ok: true, settings: value };
}
