import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type InstalledProgram, installedProgram } from "./installed-program.js";
import { launchdPlist } from "./launchd-plist.js";
import { ServiceFailedError } from "./service-failed.error.js";
import type { CommandResult, ServiceHost } from "./service-host.js";
import { SERVICE_NAMES } from "./service-names.js";
import type { ServiceProgram } from "./service-program.types.js";
import { ServiceUnsupportedError } from "./service-unsupported.error.js";
import { systemdUnit } from "./systemd-unit.js";

export type ServiceKind = "launchd" | "systemd";

/**
 * `file` is where this platform's agent or unit goes, or null on a platform with neither. `program` is what the
 * installed file runs, and whether that Node still exists; null when nothing is installed or the file is not grove's.
 */
export type ServiceStatus = {
  kind: ServiceKind | null;
  installed: boolean;
  loaded: boolean;
  file: string | null;
  program: (InstalledProgram & { nodeExists: boolean }) | null;
};

export type ServiceManager = {
  support(): Promise<ServiceKind | null>;
  install(program: ServiceProgram): Promise<{ wrote: string; removeWith: string }>;
  uninstall(): Promise<{ removed: string | null }>;
  start(): Promise<void>;
  status(): Promise<ServiceStatus>;
};

type Support = { kind: ServiceKind } | { kind: null; reason: string };

const REMOVE_WITH = "git grove service uninstall";
const BOOTSTRAP_RETRY_MS = 1000;

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

async function detect(host: ServiceHost): Promise<Support> {
  if (host.platform === "darwin") {
    const probe = await host.run("launchctl", ["print", `gui/${host.uid}`]);
    if (probe.code === 0) return { kind: "launchd" };
    return { kind: null, reason: probe.code === 127 ? "launchctl not found" : `launchctl has no login session for user ${host.uid}` };
  }
  if (host.platform === "linux") {
    const probe = await host.run("systemctl", ["--user", "show-environment"]);
    if (probe.code === 0) return { kind: "systemd" };
    const why = firstLine(probe.stderr);
    return { kind: null, reason: probe.code === 127 ? "systemctl not found" : `systemctl --user: ${why === "" ? `exit ${probe.code}` : why}` };
  }
  return { kind: null, reason: `${host.platform} has neither` };
}

async function writeWhole(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}`;
  try {
    await writeFile(temp, text, { flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Installs, removes, starts and reports grove's login service through `host`: a launchd agent
 * (`~/Library/LaunchAgents/work.grove.server.plist`, in `gui/<uid>`) on macOS when `launchctl print gui/<uid>` works,
 * a systemd user unit (`~/.config/systemd/user/git-grove.service`) on Linux when `systemctl --user show-environment`
 * works. Without either, `install` and `start` throw ServiceUnsupportedError and write nothing. `install` unloads any
 * old copy first, tries loading twice, and removes its file again when that fails (ServiceFailedError). `uninstall` unloads before
 * deleting, and deletes only its own file.
 */
export function createServiceManager(host: ServiceHost): ServiceManager {
  let detected: Promise<Support> | null = null;
  const probe = (): Promise<Support> => (detected ??= detect(host));
  const domain = `gui/${host.uid}`;
  const job = `${domain}/${SERVICE_NAMES.label}`;
  const plist = join(host.home, "Library", "LaunchAgents", `${SERVICE_NAMES.label}.plist`);
  const unit = join(host.home, ".config", "systemd", "user", SERVICE_NAMES.unit);
  const fileFor = (platform: NodeJS.Platform): string | null => (platform === "darwin" ? plist : platform === "linux" ? unit : null);

  const must = async (cmd: string, args: string[]): Promise<CommandResult> => {
    const result = await host.run(cmd, args);
    if (result.code !== 0) throw new ServiceFailedError([cmd, ...args].join(" "), result.code, result.stderr);
    return result;
  };
  const supported = async (): Promise<ServiceKind> => {
    const found = await probe();
    if (found.kind === null) throw new ServiceUnsupportedError(found.reason);
    return found.kind;
  };
  const systemctl = (...args: string[]): Promise<CommandResult> => host.run("systemctl", ["--user", ...args]);

  const installLaunchd = async (program: ServiceProgram): Promise<string> => {
    const unloaded = (await host.run("launchctl", ["bootout", job])).code === 0;
    await writeWhole(plist, launchdPlist(program));
    try {
      const first = await host.run("launchctl", ["bootstrap", domain, plist]);
      if (first.code !== 0 && unloaded) await sleep(BOOTSTRAP_RETRY_MS);
      if (first.code !== 0) await must("launchctl", ["bootstrap", domain, plist]);
    } catch (error) {
      await rm(plist, { force: true });
      throw error;
    }
    return plist;
  };
  const installSystemd = async (program: ServiceProgram): Promise<string> => {
    const text = systemdUnit(program);
    if (existsSync(unit)) await systemctl("disable", "--now", SERVICE_NAMES.unit);
    await writeWhole(unit, text);
    try {
      await must("systemctl", ["--user", "daemon-reload"]);
      await must("systemctl", ["--user", "enable", "--now", SERVICE_NAMES.unit]);
    } catch (error) {
      await rm(unit, { force: true });
      await systemctl("daemon-reload");
      throw error;
    }
    return unit;
  };

  return {
    async support() {
      return (await probe()).kind;
    },
    async install(program) {
      const kind = await supported();
      const wrote = kind === "launchd" ? await installLaunchd(program) : await installSystemd(program);
      return { wrote, removeWith: REMOVE_WITH };
    },
    async uninstall() {
      const { kind } = await probe();
      if (kind === "launchd") await host.run("launchctl", ["bootout", job]);
      if (kind === "systemd") await systemctl("disable", "--now", SERVICE_NAMES.unit);
      const file = fileFor(host.platform);
      if (file === null || !existsSync(file)) return { removed: null };
      await rm(file, { force: true });
      if (kind === "systemd") await systemctl("daemon-reload");
      return { removed: file };
    },
    async start() {
      const kind = await supported();
      if (kind === "systemd") {
        await must("systemctl", ["--user", "start", SERVICE_NAMES.unit]);
        return;
      }
      if ((await host.run("launchctl", ["print", job])).code !== 0) await must("launchctl", ["bootstrap", domain, plist]);
      await must("launchctl", ["kickstart", job]);
    },
    async status() {
      const { kind } = await probe();
      const file = fileFor(host.platform);
      const installed = file !== null && existsSync(file);
      const text = installed && file !== null ? await readFile(file, "utf8").catch(() => null) : null;
      const read = text === null ? null : installedProgram(host.platform === "darwin" ? "launchd" : "systemd", text);
      const program = read === null ? null : { ...read, nodeExists: existsSync(read.node) };
      const loaded =
        kind === "launchd"
          ? (await host.run("launchctl", ["print", job])).code === 0
          : kind === "systemd" && (await systemctl("is-active", "--quiet", SERVICE_NAMES.unit)).code === 0;
      return { kind, installed, loaded, file, program };
    },
  };
}
