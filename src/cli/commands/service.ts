import { groveHome } from "../../core/grove-home.js";
import { ServiceFailedError } from "../../core/service/service-failed.error.js";
import type { ServiceManager, ServiceStatus } from "../../core/service/service-manager.js";
import { ServiceUnsupportedError } from "../../core/service/service-unsupported.error.js";
import { privateHome } from "../../server/private-home.js";
import type { CliIo } from "../cli-io.types.js";
import { findServer } from "../find-server.js";
import { isEphemeralBin } from "../is-ephemeral-bin.js";
import { serviceProgramOf } from "../service-program-of.js";

export type ServiceSubcommand = "install" | "uninstall" | "status";

async function install(io: CliIo, service: ServiceManager, bin: string): Promise<number> {
  if (isEphemeralBin(bin)) {
    io.err("git-grove: this git grove runs from an npx cache, which npm may clear; install it first: npm i -g git-grove\n");
    return 1;
  }
  try {
    if ((await service.support()) !== null) await privateHome(groveHome());
    const installed = await service.install(serviceProgramOf(bin));
    io.out(`Installed a login service: ${installed.wrote}\nRemove it with: ${installed.removeWith}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof ServiceUnsupportedError) && !(error instanceof ServiceFailedError)) throw error;
    io.err(`${error.message}\n`);
    return 1;
  }
}

function drift(program: ServiceStatus["program"], bin: string): string | null {
  if (program === null) return "  it is not a file git grove wrote; run git grove service install";
  if (!program.nodeExists) return "  the Node it was installed with is gone; run git grove service install";
  const wanted = serviceProgramOf(bin);
  if (program.bin !== wanted.bin) return `  it runs another copy of git grove (${program.bin}); git grove ui or git grove service install points it at this one`;
  if (program.node !== wanted.node) return `  it runs another Node (${program.node}); git grove ui or git grove service install points it at this one`;
  return null;
}

async function status(io: CliIo, service: ServiceManager, bin: string): Promise<number> {
  const { kind, installed, loaded, file, program } = await service.status();
  if (kind === null) io.out("Login service: none; this machine has no launchd or systemd user session\n");
  else if (!installed) io.out(`Login service: not installed (${kind}); install it with: git grove service install\n`);
  else {
    io.out(`Login service: ${kind}, ${loaded ? "loaded" : "not loaded"}, ${file ?? ""}\n`);
    const problem = drift(program, bin);
    if (problem !== null) io.out(`${problem}\n`);
  }
  const server = await findServer(groveHome(), { waitMs: 0 });
  io.out(server === null ? "Dashboard: not running\n" : `Dashboard: http://127.0.0.1:${server.port}/ (git grove ${server.version})\n`);
  return 0;
}

/**
 * Runs `git grove service install | uninstall | status`. `install` writes and loads the login service for `bin` and
 * says how to remove it; it exits 1, writing nothing, on a machine without launchd or systemd, from an npx cache,
 * or when loading fails. `uninstall` unloads and removes it. `status` says whether it is installed and loaded, whether
 * it runs this copy of git grove with a Node that still exists, and where the dashboard runs.
 */
export async function serviceCommand(io: CliIo, sub: ServiceSubcommand, deps: { service: ServiceManager; bin: string }): Promise<number> {
  if (sub === "install") return install(io, deps.service, deps.bin);
  if (sub === "status") return status(io, deps.service, deps.bin);
  const { removed } = await deps.service.uninstall();
  io.out(removed === null ? "No login service was installed\n" : `Removed the login service: ${removed}\n`);
  return 0;
}
