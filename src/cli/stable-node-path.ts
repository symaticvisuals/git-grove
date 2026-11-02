import { realpathSync } from "node:fs";
import { delimiter, join } from "node:path";

const WELL_KNOWN = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * A path to the running Node that survives a version upgrade: the first `node` on `path`, then the first of
 * `wellKnown` (`/opt/homebrew/bin/node`, `/usr/local/bin/node`, `/usr/bin/node`), whose real path is the running
 * Node's, such as Homebrew's `/opt/homebrew/bin/node` rather than its versioned Cellar folder. The well-known places
 * cover a login service whose `PATH` is minimal. Falls back to `execPath` when none of them is the running Node.
 */
export function stableNodePath(execPath: string = process.execPath, path: string = process.env["PATH"] ?? "", wellKnown: readonly string[] = WELL_KNOWN): string {
  const running = realOrNull(execPath) ?? execPath;
  const candidates = [...path.split(delimiter).filter((folder) => folder !== "").map((folder) => join(folder, "node")), ...wellKnown];
  return candidates.find((candidate) => realOrNull(candidate) === running) ?? execPath;
}
