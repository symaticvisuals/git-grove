import type { Reason } from "../../rules/verdict.types.js";
import { displayPath } from "../display-path.js";
import { listPaths } from "../list-paths.js";

/** A verdict reason as one line, `detail: paths`, with nested worktrees shown relative to the main worktree `root`. */
export function describeReason(root: string, reason: Reason): string {
  const paths = reason.code === "nested-worktree" ? reason.paths.map((path) => displayPath(root, path)) : reason.paths;
  return paths.length > 0 ? `${reason.detail}: ${listPaths(paths)}` : reason.detail;
}
