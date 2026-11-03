import type { GuardPhase } from "../../src/core/guard-install/guard-install.types.js";

/** Whether `value` is one of the agent guard's phases. */
export function isGuardPhase(value: unknown): value is GuardPhase {
  return value === "plugin" || value === "plugin-and-hook" || value === "hook" || value === "absent";
}
