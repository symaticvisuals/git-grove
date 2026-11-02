import { join, resolve } from "node:path";
import { groveHome } from "../core/grove-home.js";
import type { ServiceProgram } from "../core/service/service-program.types.js";

/**
 * The login service program for `bin`: this Node, `bin`, this `PATH`, `GIT_GROVE_HOME` when it is set, and
 * `server.log` in grove's folder, every path absolute.
 */
export function serviceProgramOf(bin: string): ServiceProgram {
  const override = process.env["GIT_GROVE_HOME"];
  return {
    node: process.execPath,
    bin: resolve(bin),
    groveHome: override !== undefined && override !== "" ? resolve(override) : null,
    path: process.env["PATH"] ?? "/usr/bin:/bin",
    logFile: join(resolve(groveHome()), "server.log"),
  };
}
