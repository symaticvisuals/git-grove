import { realpathSync } from "node:fs";
import { delimiter, join } from "node:path";

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * A path to the running Node that survives a version upgrade: the first `node` on `path` whose real path is the
 * running Node's, such as Homebrew's `/opt/homebrew/bin/node` rather than its versioned Cellar folder. Falls back to
 * `execPath` when no `node` on `path` is the running Node.
 */
export function stableNodePath(execPath: string = process.execPath, path: string = process.env["PATH"] ?? ""): string {
  const running = realOrNull(execPath) ?? execPath;
  for (const folder of path.split(delimiter)) {
    if (folder === "") continue;
    const candidate = join(folder, "node");
    if (realOrNull(candidate) === running) return candidate;
  }
  return execPath;
}
