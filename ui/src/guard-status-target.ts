import type { GuardPhase } from "../../src/core/guard-install/guard-install.types.js";

/** What the sidebar's guard button does: open the review to remove an old hook, or go to the Getting started page. */
export function guardStatusTarget(phase: GuardPhase | null): "uninstall" | "setup" {
  return phase === "hook" || phase === "plugin-and-hook" ? "uninstall" : "setup";
}
