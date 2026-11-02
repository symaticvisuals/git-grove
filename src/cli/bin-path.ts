import { fileURLToPath } from "node:url";

/** The absolute path of this CLI's `bin.js`, the file the login service and the guard's hook run. */
export function binPath(): string {
  return fileURLToPath(new URL("./bin.js", import.meta.url));
}
