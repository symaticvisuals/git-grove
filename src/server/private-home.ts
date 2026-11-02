import { chmod, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Makes sure grove's folder `home` exists. A folder it creates is 0700, and so is `~/.git-grove`; an existing folder
 * named by `GIT_GROVE_HOME` keeps the mode its owner gave it.
 */
export async function privateHome(home: string): Promise<void> {
  const created = await mkdir(home, { recursive: true, mode: 0o700 });
  const own = created !== undefined || resolve(home) === join(homedir(), ".git-grove");
  if (own && ((await stat(home)).mode & 0o077) !== 0) await chmod(home, 0o700);
}
