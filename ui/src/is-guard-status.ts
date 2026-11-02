import type { GuardStatus } from "../../src/core/guard-install/guard-install.types.js";

/** Whether `value` is one of the agent guard's statuses. */
export function isGuardStatus(value: unknown): value is GuardStatus {
  return value === "absent" || value === "installed" || value === "stale" || value === "unreadable";
}
