import { PINS_PREFIX } from "../runner/pins-prefix.js";
import { InvalidInputError } from "./invalid-input.error.js";

export type RestoreTargetInput = { branch: string; pinRef?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTarget(item: unknown): RestoreTargetInput {
  const branch = isRecord(item) ? item["branch"] : undefined;
  if (!isRecord(item) || typeof branch !== "string" || branch === "" || branch.startsWith("-")) {
    throw new InvalidInputError("each restore target needs a branch");
  }
  const pinRef = item["pinRef"];
  if (pinRef === undefined) return { branch };
  if (typeof pinRef !== "string" || !pinRef.startsWith(PINS_PREFIX)) throw new InvalidInputError(`not a grove pin: ${String(pinRef)}`);
  return { branch, pinRef };
}

/**
 * Reads the restore action's input, `{ targets: [{ branch, pinRef? }] }`. Throws InvalidInputError unless there is at
 * least one target, each names a branch once, and each pin ref is a grove pin.
 */
export function parseRestoreTargets(raw: unknown): RestoreTargetInput[] {
  const list: unknown = isRecord(raw) ? raw["targets"] : undefined;
  if (!Array.isArray(list)) throw new InvalidInputError("restore takes { targets: [{ branch, pinRef? }] }");
  const items: unknown[] = list;
  if (items.length === 0) throw new InvalidInputError("restore needs at least one target");
  const targets = items.map(parseTarget);
  if (new Set(targets.map((target) => target.branch)).size !== targets.length) {
    throw new InvalidInputError("each branch can be restored once");
  }
  return targets;
}
