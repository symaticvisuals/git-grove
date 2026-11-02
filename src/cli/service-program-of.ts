import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { groveHome } from "../core/grove-home.js";
import { claudeConfigDir } from "../core/guard-install/claude-config-dir.js";
import type { ServiceProgram } from "../core/service/service-program.types.js";

/**
 * The login service program for `bin`: this Node, `bin`, this `PATH`, `GIT_GROVE_HOME` and `CLAUDE_CONFIG_DIR` when
 * they are set, and `server.log` in grove's folder, every path absolute.
 */
export function serviceProgramOf(bin: string): ServiceProgram {
  const override = process.env["GIT_GROVE_HOME"];
  const claude = claudeConfigDir(process.env, homedir());
  return {
    node: process.execPath,
    bin: resolve(bin),
    groveHome: override !== undefined && override !== "" ? resolve(override) : null,
    path: process.env["PATH"] ?? "/usr/bin:/bin",
    logFile: join(resolve(groveHome()), "server.log"),
    ...(claude === null ? {} : { claudeConfigDir: claude }),
  };
}
