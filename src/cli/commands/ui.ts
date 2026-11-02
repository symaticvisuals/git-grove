import { join } from "node:path";
import { groveHome } from "../../core/grove-home.js";
import type { ServiceManager } from "../../core/service/service-manager.js";
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
import { isEphemeralBin } from "../is-ephemeral-bin.js";
import { packageVersion } from "../package-version.js";
import { serviceProgramOf } from "../service-program-of.js";

export type UiDeps = {
  service: ServiceManager;
  openUrl(url: string): Promise<boolean>;
  serveForeground(): Promise<Pick<RunningServer, "port" | "token">>;
  /** The absolute path of this CLI's `dist/cli/bin.js`, which a login service runs. */
  bin: string;
  /** How long to wait for a server after a restart, an install or a start; 5 s by default. */
  waitMs?: number;
};

const WAIT_MS = 5000;

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

async function handOver(io: CliIo, home: string, info: ServerInfo, waitMs: number): Promise<ServerInfo | null> {
  const version = packageVersion();
  if (compareVersions(info.version, version) >= 0) return info;
  if (!(await askServerToExit(info.port, await readOrCreateToken(home)))) return info;
  io.out(`Restarting git grove ${info.version} as ${version}\n`);
  return findServer(home, { waitMs, except: info.pid });
}

async function alignService(io: CliIo, deps: UiDeps, home: string): Promise<boolean> {
  if (isEphemeralBin(deps.bin) || (await deps.service.support()) === null) return false;
  const { installed, program } = await deps.service.status();
  const wanted = serviceProgramOf(deps.bin);
  if (!installed || (program !== null && program.nodeExists && program.node === wanted.node && program.bin === wanted.bin)) return false;
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
    io.out("This git grove runs from an npx cache, so it installs no login service; for one, install it: npm i -g git-grove\n");
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
 * Runs `git grove ui`: registers the repository around the current folder, makes sure a dashboard server runs and
 * opens it at the current worktree's feature. An installed login service that runs another copy of git grove, or a
 * Node that is gone, is rewritten to run this one. A server older than this CLI is asked to exit, so its login service
 * starts this version. With no server, the login service is installed (and says how to remove it) or started; on a
 * machine without launchd or systemd, or from an npx cache, the server runs in this process instead, until Ctrl-C.
 * The browser opens through `openUrl`; with `GIT_GROVE_NO_OPEN=1`, or when that fails, the address is printed.
 */
export async function uiCommand(io: CliIo, deps: UiDeps): Promise<number> {
  const home = groveHome();
  const waitMs = deps.waitMs ?? WAIT_MS;
  const target = await dashboardTarget(io.cwd, home);
  const updated = await alignService(io, deps, home);
  let info = await findServer(home, { waitMs: updated ? waitMs : 0 });
  if (info !== null) info = await handOver(io, home, info, waitMs);
  if (info === null) info = await startService(io, deps, home, waitMs);
  const server = info === null ? await serveHere(io, deps, home, waitMs) : { port: info.port, token: await readOrCreateToken(home), foreground: false };
  const url = dashboardUrl(server.port, server.token, target);
  const opened = process.env["GIT_GROVE_NO_OPEN"] !== "1" && (await deps.openUrl(url));
  io.out(opened ? `Opened the dashboard at http://127.0.0.1:${server.port}/\n` : `Open the dashboard: ${url}\n`);
  if (server.foreground) io.out("Serving in the foreground; press Ctrl-C to stop\n");
  return 0;
}
