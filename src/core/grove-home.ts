import { homedir } from "node:os";
import { join } from "node:path";

/** Grove's own folder: `$GIT_GROVE_HOME` when set and not empty, else `~/.git-grove`. */
export function groveHome(): string {
  const override = process.env["GIT_GROVE_HOME"];
  return override !== undefined && override !== "" ? override : join(homedir(), ".git-grove");
}
