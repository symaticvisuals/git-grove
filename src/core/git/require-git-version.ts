import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitVersionError } from "./git-version.error.js";

const execFileAsync = promisify(execFile);

export function parseGitVersion(output: string): [number, number, number] {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) throw new GitVersionError(`git-grove could not read the git version from "${output.trim()}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/**
 * Throws GitVersionError unless the installed git is at least `min` (major, minor).
 */
export async function requireGitVersion(min: [number, number]): Promise<void> {
  const { stdout } = await execFileAsync("git", ["--version"]);
  const [major, minor] = parseGitVersion(stdout);
  if (major > min[0] || (major === min[0] && minor >= min[1])) return;
  throw new GitVersionError(`git-grove needs git ${min[0]}.${min[1]} or newer (found ${major}.${minor})`);
}
