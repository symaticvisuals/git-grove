import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { runGit } from "../git/run-git.js";

export const IGNORED_FILE_LIMIT = 2000;

const REGENERABLE_FOLDERS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "target",
  ".cache",
  "coverage",
]);

const JUNK_FOLDERS = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);
const JUNK_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * `unreadable` holds the worktree-relative folders (ending in `/`) and files the walk could not inspect;
 * `nestedRepos` the worktree-relative folders, inside ignored ones, that hold a `.git` of their own.
 */
export type IgnoredListing = { files: string[]; truncated: boolean; unreadable: string[]; nestedRepos: string[] };

export type IgnoredListingOptions = {
  limit?: number;
  accept?: (relative: string) => boolean;
};

function isJunk(relative: string): boolean {
  const segments = relative.split("/").filter((segment) => segment !== "");
  return segments.some((segment) => JUNK_FOLDERS.has(segment)) || JUNK_FILES.has(segments.at(-1) ?? "");
}

/**
 * Whether `entry` (as git listed it) is, or lies inside, a regenerable folder that is itself ignored:
 * either git reported that folder whole, or `git check-ignore` matches it. A regenerable name on a tracked folder
 * does not count, so a hand-made ignored file in a tracked `build/` is still examined.
 */
async function inIgnoredRegenerable(entry: string, isIgnoredFolder: (folder: string) => Promise<boolean>): Promise<boolean> {
  const segments = entry.replace(/\/$/, "").split("/");
  const folders = entry.endsWith("/") ? segments : segments.slice(0, -1);
  for (const [index, segment] of folders.entries()) {
    if (!REGENERABLE_FOLDERS.has(segment)) continue;
    const folder = `${segments.slice(0, index + 1).join("/")}/`;
    if (folder === entry || (await isIgnoredFolder(folder))) return true;
  }
  return false;
}

function isInside(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path === folder || path.startsWith(folder + sep));
}

async function readEntries(folder: string): Promise<Dirent[] | null> {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function* walk(
  root: string,
  relative: string,
  skipFolders: readonly string[],
  found: Pick<IgnoredListing, "unreadable" | "nestedRepos">,
): AsyncGenerator<string> {
  const entries = await readEntries(join(root, relative));
  if (entries === null) {
    found.unreadable.push(relative);
    return;
  }
  for (const entry of entries) {
    const child = `${relative}${entry.name}`;
    if (entry.name === ".git") {
      found.nestedRepos.push(relative.replace(/\/$/, ""));
      continue;
    }
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (JUNK_FOLDERS.has(entry.name) || isInside(join(root, child), skipFolders)) continue;
      yield* walk(root, `${child}/`, skipFolders, found);
    } else if (!JUNK_FILES.has(entry.name)) {
      yield child;
    }
  }
}

async function fileKind(path: string): Promise<"symlink" | "file" | "unreadable"> {
  try {
    return (await lstat(path)).isSymbolicLink() ? "symlink" : "file";
  } catch {
    return "unreadable";
  }
}

/**
 * Lists the gitignored files in a worktree, worktree-relative, with directories expanded.
 * Entries in a regenerable folder (node_modules, dist, build ...) are dropped only when that folder is itself ignored;
 * inside any other ignored folder every file counts. OS and tool junk (.DS_Store, __pycache__, .mypy_cache ...)
 * is dropped everywhere. Symlinks and folders that are other worktrees are skipped.
 * Directory entries git reports alongside their contents are collapsed to one entry per file.
 * Folders that cannot be opened and files that cannot be inspected are listed in `unreadable`.
 * A walked folder holding a `.git` folder or file is a git repository of its own and is listed in `nestedRepos`; its
 * files are still examined. Regenerable and junk folders are not walked, so repositories inside them are not found.
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
  const ignoredFolders = new Map<string, Promise<boolean>>();
  const isIgnoredFolder = (folder: string): Promise<boolean> => {
    const known = ignoredFolders.get(folder);
    if (known) return known;
    const check = runGit(["check-ignore", "-q", "--no-index", folder], { cwd: worktreePath, allowFailure: true }).then(
      (result) => result.code === 0,
      () => false,
    );
    ignoredFolders.set(folder, check);
    return check;
  };
  const nested = otherWorktrees.filter((other) => other.startsWith(worktreePath + sep));
  const files = new Set<string>();
  const found: Pick<IgnoredListing, "unreadable" | "nestedRepos"> = { unreadable: [], nestedRepos: [] };
  const add = (file: string): boolean => {
    if (accept(file)) files.add(file);
    return files.size > limit;
  };
  for (const entry of stdout.split("\0")) {
    if (entry === "" || isJunk(entry) || (await inIgnoredRegenerable(entry, isIgnoredFolder))) continue;
    if (!entry.endsWith("/")) {
      const kind = await fileKind(join(worktreePath, entry));
      if (kind === "unreadable") found.unreadable.push(entry);
      else if (kind === "file" && add(entry)) return { files: [], truncated: true, ...found };
    } else if (!isInside(join(worktreePath, entry), nested)) {
      for await (const file of walk(worktreePath, entry, nested, found)) {
        if (add(file)) return { files: [], truncated: true, ...found };
      }
    }
  }
  return { files: [...files], truncated: false, ...found };
}
