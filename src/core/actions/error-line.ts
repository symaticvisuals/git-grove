import { StalePlanError } from "./stale-plan.error.js";

/** An error as one line for a receipt or step: a stale plan's mismatches, else the message's first line without `git-grove: `. */
export function errorLine(error: unknown): string {
  if (error instanceof StalePlanError) return error.mismatches.join("; ");
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? message).replace(/^git-grove: /, "");
}
