import { lstat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { runGit } from "../git/run-git.js";

export const IGNORED_FILE_LIMIT = 2000;

const REGENERABLE_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".cache",
  "coverage",
]);

export type IgnoredListing = { files: string[]; truncated: boolean };

export type IgnoredListingOptions = {
  limit?: number;
  accept?: (relative: string) => boolean;
};

function isRegenerable(relative: string): boolean {
  return relative.split("/").some((segment) => REGENERABLE_SEGMENTS.has(segment));
}

function isInside(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path === folder || path.startsWith(folder + sep));
}

async function* walk(root: string, relative: string, skipFolders: readonly string[]): AsyncGenerator<string> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const child = `${relative}${entry.name}`;
    if (entry.name === ".git" || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isInside(join(root, child), skipFolders)) continue;
      yield* walk(root, `${child}/`, skipFolders);
    } else {
      yield child;
    }
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return true;
  }
}

/**
 * Lists the gitignored files in a worktree, worktree-relative, with directories expanded.
 * Ignored roots git reports under a regenerable folder (node_modules, dist, build ...) are dropped;
 * inside any other ignored folder every file counts. Symlinks and folders that are other worktrees are skipped.
 * Directory entries git reports alongside their contents are collapsed to one entry per file.
 * Stops and reports `truncated` once more than `limit` accepted files have been examined.
 */
export async function listIgnoredFiles(
  worktreePath: string,
  otherWorktrees: readonly string[],
  options: IgnoredListingOptions = {},
): Promise<IgnoredListing> {
  const limit = options.limit ?? IGNORED_FILE_LIMIT;
  const accept = options.accept ?? (() => true);
  const { stdout } = await runGit(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], {
    cwd: worktreePath,
  });
  const nested = otherWorktrees.filter((other) => other.startsWith(worktreePath + sep));
  const files = new Set<string>();
  const add = (file: string): boolean => {
    if (accept(file)) files.add(file);
    return files.size > limit;
  };
  for (const entry of stdout.split("\0")) {
    if (entry === "" || isRegenerable(entry)) continue;
    if (!entry.endsWith("/")) {
      if (!(await isSymlink(join(worktreePath, entry))) && add(entry)) return { files: [], truncated: true };
    } else if (!isInside(join(worktreePath, entry), nested)) {
      for await (const file of walk(worktreePath, entry, nested)) {
        if (add(file)) return { files: [], truncated: true };
      }
    }
  }
  return { files: [...files], truncated: false };
}
