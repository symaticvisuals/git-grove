import { isJsonObject } from "./is-json-object.js";
import { listOf } from "./list-of.js";

const SUFFIX = " guard --claude";

function isGroveHook(hook: unknown): hook is Record<string, unknown> {
  if (!isJsonObject(hook) || hook["type"] !== "command") return false;
  const command = hook["command"];
  return typeof command === "string" && command.endsWith(SUFFIX);
}

/** The hooks of grove's own in a `PreToolUse` group: in a group whose `matcher` is `"Bash"`, each command hook whose command ends in ` guard --claude`. */
export function groveHooksOf(group: unknown): Record<string, unknown>[] {
  if (!isJsonObject(group) || group["matcher"] !== "Bash") return [];
  return (listOf(group["hooks"]) ?? []).filter(isGroveHook);
}
