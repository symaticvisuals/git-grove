import type { Severity } from "../../core/rules/rule.types.js";

export type Health = "loses" | "action" | "review" | "idle" | "fine";

const HEALTH: Record<Severity | "fine", Health> = {
  "loses-work": "loses",
  "needs-action": "action",
  "waiting-on-review": "review",
  idle: "idle",
  fine: "fine",
};

/** The dashboard's word for a severity, or `"fine"` when nothing is wrong. */
export function healthOf(severity: Severity | "fine"): Health {
  return HEALTH[severity];
}
