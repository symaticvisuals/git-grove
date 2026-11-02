import { isJsonObject } from "./is-json-object.js";
import { listOf } from "./list-of.js";

const SUFFIX = " guard --claude";

function matchesBash(matcher: unknown): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  return typeof matcher === "string" && matcher.split("|").some((part) => part.trim() === "Bash");
}

function isGroveCommand(command: string): boolean {
  if (!command.endsWith(SUFFIX)) return false;
  const runs = command.slice(0, -SUFFIX.length);
  return /\/dist\/cli\/bin\.js'?$/.test(runs) || /git-grove|git grove/.test(runs);
}

function isGroveHook(hook: unknown): hook is Record<string, unknown> {
  if (!isJsonObject(hook) || hook["type"] !== "command") return false;
  const command = hook["command"];
  return typeof command === "string" && isGroveCommand(command);
}

/**
 * The hooks of grove's own in a `PreToolUse` group: in a group whose `matcher` matches Bash (`"Bash"`, a `|` list
 * naming it, `"*"`, `""` or none), each command hook that runs grove's guard, by what grove writes: a command ending
 * in `/dist/cli/bin.js guard --claude`, or one naming `git-grove` or `git grove` before `guard --claude`.
 */
export function groveHooksOf(group: unknown): Record<string, unknown>[] {
  if (!isJsonObject(group) || !matchesBash(group["matcher"])) return [];
  return (listOf(group["hooks"]) ?? []).filter(isGroveHook);
}
