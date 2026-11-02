import { groveHooksOf } from "./grove-hooks-of.js";
import { isJsonObject } from "./is-json-object.js";
import { listOf } from "./list-of.js";

export type WithoutGroveHooks = { kept: unknown[]; removed: unknown[] };

/**
 * A `PreToolUse` list without grove's hooks, every other group and hook kept in order. A group that held only grove's
 * hooks is dropped and listed whole in `removed`; from a group that also holds others, only grove's hooks go.
 */
export function removeGroveHooks(groups: readonly unknown[]): WithoutGroveHooks {
  const kept: unknown[] = [];
  const removed: unknown[] = [];
  for (const group of groups) {
    const grove = groveHooksOf(group);
    if (grove.length === 0 || !isJsonObject(group)) {
      kept.push(group);
      continue;
    }
    const rest = (listOf(group["hooks"]) ?? []).filter((hook) => !grove.some((own) => own === hook));
    if (rest.length === 0) {
      removed.push(group);
      continue;
    }
    removed.push(...grove);
    kept.push({ ...group, hooks: rest });
  }
  return { kept, removed };
}
