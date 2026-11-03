import { join } from "node:path";
import { writeHookCommand } from "../../core/guard-install/hook-command.js";
import { PLUGIN_INSTALL } from "../../core/guard-install/plugin-commands.js";
import { groveHome } from "../../core/grove-home.js";
import { isEphemeralBin } from "../../core/is-ephemeral-bin.js";
import type { ServiceManager, ServiceStatus } from "../../core/service/service-manager.js";
import type { ServiceProgram } from "../../core/service/service-program.types.js";
import { readOrCreateToken } from "../../server/auth/read-or-create-token.js";
import { privateHome } from "../../server/private-home.js";
import { ServerRunningError } from "../../server/server-running.error.js";
import type { ServerInfo } from "../../server/server-info.types.js";
import type { RunningServer } from "../../server/start-server.js";
import { askServerToExit } from "../ask-server-to-exit.js";
import type { CliIo } from "../cli-io.types.js";
import { compareVersions } from "../compare-versions.js";
import { dashboardTarget } from "../dashboard-target.js";
import { dashboardUrl } from "../dashboard-url.js";
import { findServer } from "../find-server.js";
import { packageVersion } from "../package-version.js";
import { servedSettingsPath } from "../served-settings-path.js";
import { serviceProgramOf } from "../service-program-of.js";
import { stableNodePath } from "../stable-node-path.js";
import { waitForExit } from "../wait-for-exit.js";

export type UiDeps = {
  service: ServiceManager;
  openUrl(url: string): Promise<boolean>;
  serveForeground(): Promise<Pick<RunningServer, "port" | "token">>;
  /** The absolute path of this CLI's `dist/cli/bin.js`, which a login service runs. */
  bin: string;
  /** How long to wait for a server after an install or a start; 5 s by default. */
  waitMs?: number;
  /** How long to wait for an older server asked to exit: for its service to start this version, or for it to stop; 15 s by default. */
  restartWaitMs?: number;
  /** Whether the agent guard is really on (`guardPhaseOf`); without it, `ui` never mentions the guard. */
  guardDone?(): Promise<boolean>;
  /** The Node the dashboard records for the plugin's hook; this process's stable Node by default. */
  node?: string;
  /** The settings file Claude Code reads from this shell; when given, `ui` says so if the dashboard would install the guard elsewhere. */
  claudeSettingsPath?: string;
};

const WAIT_MS = 5000;
const PROTECT = `Protect your worktrees from Claude Code: ${PLUGIN_INSTALL.join(", then ")}\n`;
const RESTART_WAIT_MS = 15_000;

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

async function warnOnOtherSettings(io: CliIo, deps: UiDeps, port: number, token: string): Promise<void> {
  if (deps.claudeSettingsPath === undefined) return;
  const served = await servedSettingsPath(port, token);
  if (served === null || served === deps.claudeSettingsPath) return;
  io.out(`The dashboard installs the agent guard into ${served}, but Claude Code here reads ${deps.claudeSettingsPath}: the server and this shell differ in CLAUDE_CONFIG_DIR.\n`);
}

async function guardNotDone(deps: UiDeps): Promise<boolean> {
  if (deps.guardDone === undefined) return false;
  return !(await deps.guardDone().catch(() => true));
}

function runsWanted(program: ServiceStatus["program"], wanted: ServiceProgram): boolean {
  return (
    program !== null &&
    program.nodeExists &&
    program.node === wanted.node &&
    program.bin === wanted.bin &&
    program.groveHome === wanted.groveHome &&
    (program.claudeConfigDir ?? null) === (wanted.claudeConfigDir ?? null)
  );
}

async function installedService(deps: UiDeps): Promise<ServiceStatus | null> {
  if ((await deps.service.support()) === null) return null;
  const status = await deps.service.status();
  return status.installed ? status : null;
}

async function handOver(io: CliIo, deps: UiDeps, home: string, info: ServerInfo): Promise<ServerInfo | null> {
  const version = packageVersion();
  if (compareVersions(info.version, version) >= 0) return info;
  const service = await installedService(deps);
  if (service !== null && service.program?.bin !== serviceProgramOf(deps.bin).bin) {
    io.out(`The login service runs git grove ${info.version}. Run npm i -g @deepanshugoel/git-grove to update it.\n`);
    return info;
  }
  if (!(await askServerToExit(info.port, await readOrCreateToken(home)))) return info;
  const restarting = `Restarting git grove ${info.version} as ${version}\n`;
  const waitMs = deps.restartWaitMs ?? RESTART_WAIT_MS;
  if (service !== null) {
    io.out(restarting);
    return findServer(home, { waitMs, except: info });
  }
  if (await waitForExit(home, info, waitMs)) {
    io.out(restarting);
    return null;
  }
  io.out(`git grove ${info.version} is still finishing a run; opening it\n`);
  return info;
}

async function alignService(io: CliIo, deps: UiDeps, home: string): Promise<boolean> {
  if (isEphemeralBin(deps.bin) || (await deps.service.support()) === null) return false;
  const { installed, program } = await deps.service.status();
  const wanted = serviceProgramOf(deps.bin);
  if (!installed || runsWanted(program, wanted)) return false;
  try {
    await privateHome(home);
    await deps.service.install(wanted);
  } catch (error) {
    io.err(`${firstLine(error)}\n`);
    return false;
  }
  io.out("Updated the login service to this copy of git grove\n");
  return true;
}

async function startService(io: CliIo, deps: UiDeps, home: string, waitMs: number): Promise<ServerInfo | null> {
  if (isEphemeralBin(deps.bin)) {
    io.out("This git grove runs from an npx cache, so it installs no login service; for one, install it: npm i -g @deepanshugoel/git-grove\n");
    return null;
  }
  if ((await deps.service.support()) === null) {
    io.out("No launchd or systemd user session here, so git grove serves in the foreground\n");
    return null;
  }
  try {
    if ((await deps.service.status()).installed) await deps.service.start();
    else {
      await privateHome(home);
      const installed = await deps.service.install(serviceProgramOf(deps.bin));
      io.out(`Installed a login service: ${installed.wrote}\nRemove it with: ${installed.removeWith}\n`);
    }
  } catch (error) {
    io.err(`${firstLine(error)}\n`);
    return null;
  }
  const started = await findServer(home, { waitMs });
  if (started === null) io.err(`git-grove: the login service has not started git grove yet; its log is ${join(home, "server.log")}\n`);
  return started;
}

async function serveHere(io: CliIo, deps: UiDeps, home: string, waitMs: number): Promise<{ port: number; token: string; foreground: boolean }> {
  try {
    const running = await deps.serveForeground();
    return { port: running.port, token: running.token, foreground: true };
  } catch (error) {
    if (!(error instanceof ServerRunningError)) throw error;
    const info = await findServer(home, { waitMs });
    if (info === null) throw error;
    return { port: info.port, token: await readOrCreateToken(home), foreground: false };
  }
}

/**
 * Runs `git grove ui`: registers the repository around the current folder, makes sure a dashboard server runs and opens
 * it at the current worktree's feature. An installed login service that runs another copy of git grove, another grove
 * folder, another Claude Code folder, or a Node that is gone, is rewritten to run this one. A server older than this
 * CLI is asked to exit only when no service is installed or the service runs this copy: the service then has 15 s to
 * start this version before it is started, and with no service this one starts as soon as the old one has stopped; an
 * old one still finishing a run after those 15 s is opened instead, saying so. A service that runs another copy keeps
 * its server, and `ui` says how to update it. With no server, the login service is installed (and says how to remove
 * it) or started; on a machine without launchd or systemd, or from an npx cache, the server runs in this process
 * instead, until Ctrl-C. When a running server would install the agent guard into another settings file than this
 * shell's Claude Code reads, `ui` names both. On every run while the agent guard is not really on (`guardDone`), it
 * prints one line with the plugin's install commands. The browser opens through `openUrl`; with `GIT_GROVE_NO_OPEN=1`,
 * or when that fails, the address is printed.
 */
export async function uiCommand(io: CliIo, deps: UiDeps): Promise<number> {
  const home = groveHome();
  await writeHookCommand(home, deps.node ?? stableNodePath(), deps.bin).catch((error: unknown) => io.err(`git-grove: could not record hook-command: ${firstLine(error)}\n`));
  const waitMs = deps.waitMs ?? WAIT_MS;
  const target = await dashboardTarget(io.cwd, home);
  const updated = await alignService(io, deps, home);
  let info = await findServer(home, { waitMs: updated ? waitMs : 0 });
  if (info !== null) info = await handOver(io, deps, home, info);
  if (info === null) info = await startService(io, deps, home, waitMs);
  const server = info === null ? await serveHere(io, deps, home, waitMs) : { port: info.port, token: await readOrCreateToken(home), foreground: false };
  if (!server.foreground) await warnOnOtherSettings(io, deps, server.port, server.token);
  if (await guardNotDone(deps)) io.out(PROTECT);
  const url = dashboardUrl(server.port, server.token, target);
  const opened = process.env["GIT_GROVE_NO_OPEN"] !== "1" && (await deps.openUrl(url));
  io.out(opened ? `Opened the dashboard at http://127.0.0.1:${server.port}/\n` : `Open the dashboard: ${url}\n`);
  if (server.foreground) io.out("Serving in the foreground; press Ctrl-C to stop\n");
  return 0;
}
