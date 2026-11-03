import type { GuardPhase } from "../../src/core/guard-install/guard-install.types.js";

/**
 * What the sidebar's guard button does: open the review to remove an old hook while the plugin runs too, or go to the
 * Getting started page, which installs the plugin before the old hook goes.
 */
export function guardStatusTarget(phase: GuardPhase | null): "uninstall" | "setup" {
  return phase === "plugin-and-hook" ? "uninstall" : "setup";
}
