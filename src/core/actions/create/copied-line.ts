import { plural } from "../../rules/plural.js";
import { listPaths } from "../list-paths.js";

/** Why an env file a symlinked folder would send elsewhere is not copied. */
export const THROUGH_LINK = "a folder on the way is a symlink, so it would land outside where it belongs";

/** What an env copy did, in one line. */
export function copiedLine(copied: readonly string[], kept: readonly string[], skipped: readonly string[]): string {
  const there = kept.length > 0 ? `, ${kept.length} already there` : "";
  const linked = skipped.length > 0 ? `, ${skipped.length} not copied (${listPaths([...skipped])}: ${THROUGH_LINK})` : "";
  return `${plural(copied.length, "env file")} copied${there}${linked}`;
}
