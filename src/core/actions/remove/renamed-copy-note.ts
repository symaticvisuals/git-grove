import { listPaths } from "../list-paths.js";
import type { RescuedFile } from "./verify-copies.js";

/**
 * The note a plan carries when a rescued file takes another name in main, since `git grove check remove` only counts
 * a copy at the same path; null when every copy keeps its path.
 */
export function renamedCopyNote(copies: readonly RescuedFile[]): string | null {
  const renamed = copies.filter((copy) => copy.to !== copy.from).map((copy) => copy.from);
  if (renamed.length === 0) return null;
  return `git grove check remove only counts a copy at the same path, so after the commands above it still names ${listPaths(renamed)} and stops them; grove checks the renamed copies byte for byte when it runs.`;
}
