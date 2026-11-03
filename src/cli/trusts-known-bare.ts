import { existsSync } from "node:fs";
import { join } from "node:path";
import { groveHome } from "../core/grove-home.js";

/**
 * Whether the guard may check a bare repository: only one grove already watches, by its common git dir. Loads
 * `node:sqlite` only when grove's database exists.
 */
export async function trustsKnownBare(commonDir: string): Promise<boolean> {
  const path = join(groveHome(), "grove.db");
  if (!existsSync(path)) return false;
  const { isKnownRepo } = await import("../core/journal/is-known-repo.js");
  return isKnownRepo(path, commonDir);
}
