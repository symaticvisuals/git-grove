import { isJsonObject } from "./is-json-object.js";

export type ParsedSettings = { ok: true; settings: Record<string, unknown> } | { ok: false; problem: string };

function inexact(value: unknown): boolean {
  return typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)));
}

/**
 * Reads a settings file's text as strict JSON, the way Claude Code does. No file, or one holding only whitespace, is
 * `{}`. Anything else must be a JSON object, with no byte-order mark, no number grove cannot write back exactly (not
 * finite, or an integer past the safe range), a `hooks`, when present, that is an object and a `hooks.PreToolUse`,
 * when present, that is a list; otherwise `problem` says what is wrong, as a phrase that follows "It".
 */
export function parseClaudeSettings(text: string | null): ParsedSettings {
  if (text?.startsWith("\uFEFF") === true) return { ok: false, problem: "starts with a byte-order mark" };
  if (text === null || text.trim() === "") return { ok: true, settings: {} };
  let lossy = false;
  let value: unknown;
  try {
    value = JSON.parse(text, (_key: string, item: unknown): unknown => {
      if (inexact(item)) lossy = true;
      return item;
    });
  } catch (error) {
    return { ok: false, problem: `is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (lossy) return { ok: false, problem: "holds a number grove cannot write back exactly" };
  if (!isJsonObject(value)) return { ok: false, problem: "is not a JSON object" };
  const hooks = value["hooks"];
  if (hooks !== undefined && !isJsonObject(hooks)) return { ok: false, problem: 'has a "hooks" that is not an object' };
  if (hooks !== undefined && hooks["PreToolUse"] !== undefined && !Array.isArray(hooks["PreToolUse"])) {
    return { ok: false, problem: 'has a "hooks.PreToolUse" that is not a list' };
  }
  return { ok: true, settings: value };
}
