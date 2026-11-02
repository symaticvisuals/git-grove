import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { ServiceHost } from "../../../src/core/service/service-host.js";
import { createServiceManager } from "../../../src/core/service/service-manager.js";
import type { ServiceProgram } from "../../../src/core/service/service-program.types.js";
import { ServiceFailedError } from "../../../src/core/service/service-failed.error.js";
import { ServiceUnsupportedError } from "../../../src/core/service/service-unsupported.error.js";

type Reply = { code: number; stdout?: string; stderr?: string };
type FakeHost = ServiceHost & { calls: string[] };

const PROGRAM: ServiceProgram = {
  node: "/opt/node/bin/node",
  bin: "/opt/grove/dist/cli/bin.js",
  groveHome: null,
  path: "/opt/homebrew/bin:/usr/bin:/bin",
  logFile: "/Users/me/.git-grove/server.log",
};

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-service-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** A host that records every command and answers from `replies` (first match by prefix), else exit 0. */
function fakeHost(platform: NodeJS.Platform, replies: Record<string, Reply> = {}): FakeHost {
  const calls: string[] = [];
  return {
    platform,
    home,
    uid: 501,
    path: "/usr/bin:/bin",
    calls,
    async run(cmd, args) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      const match = Object.entries(replies).find(([prefix]) => line.startsWith(prefix));
      const reply = match?.[1] ?? { code: 0 };
      return { code: reply.code, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
    },
  };
}

const PLIST = (): string => join(home, "Library", "LaunchAgents", "work.grove.server.plist");
const UNIT = (): string => join(home, ".config", "systemd", "user", "git-grove.service");

test("on macOS, install writes the plist and bootstraps it", async () => {
  const host = fakeHost("darwin");
  const manager = createServiceManager(host);
  expect(await manager.support()).toBe("launchd");
  const installed = await manager.install(PROGRAM);
  expect(installed).toEqual({ wrote: PLIST(), removeWith: "git grove service uninstall" });
  const plist = await readFile(PLIST(), "utf8");
  for (const part of ["<string>work.grove.server</string>", "<string>serve</string>", "RunAtLoad", "SuccessfulExit", "server.log"]) {
    expect(plist).toContain(part);
  }
  expect(host.calls).toContain(`launchctl bootstrap gui/501 ${PLIST()}`);
  const bootout = host.calls.indexOf("launchctl bootout gui/501/work.grove.server");
  expect(bootout).toBeGreaterThanOrEqual(0);
  expect(bootout).toBeLessThan(host.calls.indexOf(`launchctl bootstrap gui/501 ${PLIST()}`));
});

test("on Linux with a user systemd, install writes git-grove.service and enables it", async () => {
  const host = fakeHost("linux");
  const manager = createServiceManager(host);
  expect(await manager.support()).toBe("systemd");
  const installed = await manager.install(PROGRAM);
  expect(installed).toEqual({ wrote: UNIT(), removeWith: "git grove service uninstall" });
  const unit = await readFile(UNIT(), "utf8");
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("WantedBy=default.target");
  expect(unit).toContain('ExecStart="/opt/node/bin/node" "/opt/grove/dist/cli/bin.js" serve');
  expect(host.calls).toContain("systemctl --user show-environment");
  expect(host.calls).toContain("systemctl --user daemon-reload");
  expect(host.calls).toContain("systemctl --user enable --now git-grove.service");
});

test.each([
  ["linux, where systemctl --user show-environment exits 1", "linux", { "systemctl --user show-environment": { code: 1, stderr: "Failed to connect to bus: No medium found\n" } }],
  ["darwin, with no launchctl", "darwin", { launchctl: { code: 127, stderr: "spawn launchctl ENOENT" } }],
  ["a platform with neither", "freebsd", {}],
] as const)("with no launchd or systemd (%s), support is null and install throws ServiceUnsupportedError naming git grove serve", async (_name, platform, replies) => {
  const host = fakeHost(platform, replies);
  const manager = createServiceManager(host);
  expect(await manager.support()).toBeNull();
  const install = manager.install(PROGRAM);
  await expect(install).rejects.toBeInstanceOf(ServiceUnsupportedError);
  await expect(install).rejects.toThrow("no launchd or systemd user session here");
  await expect(install).rejects.toThrow("run git grove serve yourself");
  expect(await readdir(home)).toEqual([]);
  expect(host.calls.every((call) => !/bootstrap|enable|daemon-reload/.test(call))).toBe(true);
});

test("the reason a session is missing is part of the message", async () => {
  const manager = createServiceManager(fakeHost("linux", { "systemctl --user show-environment": { code: 1, stderr: "Failed to connect to bus: No medium found\n" } }));
  await expect(manager.install(PROGRAM)).rejects.toThrow("Failed to connect to bus: No medium found");
});

test("a bootstrap that fails leaves no plist behind and says which command failed", async () => {
  const host = fakeHost("darwin", {
    "launchctl bootout": { code: 3, stderr: "Boot-out failed: 3: No such process\n" },
    "launchctl bootstrap": { code: 5, stderr: "Bootstrap failed: 5: Input/output error\n" },
  });
  const install = createServiceManager(host).install(PROGRAM);
  await expect(install).rejects.toBeInstanceOf(ServiceFailedError);
  await expect(install).rejects.toThrow("launchctl bootstrap gui/501");
  await expect(install).rejects.toThrow("Input/output error");
  expect(existsSync(PLIST())).toBe(false);
});

test("an enable that fails leaves no unit behind", async () => {
  const host = fakeHost("linux", { "systemctl --user enable": { code: 1, stderr: "Failed to enable unit\n" } });
  await expect(createServiceManager(host).install(PROGRAM)).rejects.toBeInstanceOf(ServiceFailedError);
  expect(existsSync(UNIT())).toBe(false);
  expect(host.calls.at(-1)).toBe("systemctl --user daemon-reload");
});

test("uninstall unloads and removes only its own file", async () => {
  const agents = join(home, "Library", "LaunchAgents");
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, "com.example.other.plist"), "theirs");
  const host = fakeHost("darwin");
  const manager = createServiceManager(host);
  await manager.install(PROGRAM);
  host.calls.length = 0;
  expect(await manager.uninstall()).toEqual({ removed: PLIST() });
  expect(host.calls).toEqual(["launchctl bootout gui/501/work.grove.server"]);
  expect(await readdir(agents)).toEqual(["com.example.other.plist"]);
  expect(await manager.uninstall()).toEqual({ removed: null });
});

test("uninstall on Linux disables the unit, removes it and reloads", async () => {
  const host = fakeHost("linux");
  const manager = createServiceManager(host);
  await manager.install(PROGRAM);
  host.calls.length = 0;
  expect(await manager.uninstall()).toEqual({ removed: UNIT() });
  expect(host.calls).toEqual(["systemctl --user disable --now git-grove.service", "systemctl --user daemon-reload"]);
  expect(existsSync(UNIT())).toBe(false);
});

test("start kickstarts the launchd job, loading it first when it is not loaded", async () => {
  const host = fakeHost("darwin", { "launchctl print gui/501/work.grove.server": { code: 113 } });
  const manager = createServiceManager(host);
  await manager.install(PROGRAM);
  host.calls.length = 0;
  await manager.start();
  expect(host.calls).toEqual([
    "launchctl print gui/501/work.grove.server",
    `launchctl bootstrap gui/501 ${PLIST()}`,
    "launchctl kickstart gui/501/work.grove.server",
  ]);
});

test("start runs systemctl --user start on Linux", async () => {
  const host = fakeHost("linux");
  const manager = createServiceManager(host);
  await manager.start();
  expect(host.calls).toEqual(["systemctl --user show-environment", "systemctl --user start git-grove.service"]);
});

test("status says which manager, whether the file is there and whether it is loaded", async () => {
  const host = fakeHost("darwin", { "launchctl print gui/501/work.grove.server": { code: 113 } });
  const manager = createServiceManager(host);
  expect(await manager.status()).toEqual({ kind: "launchd", installed: false, loaded: false, file: PLIST() });
  await manager.install(PROGRAM);
  expect(await manager.status()).toEqual({ kind: "launchd", installed: true, loaded: false, file: PLIST() });
  const loaded = createServiceManager(fakeHost("darwin"));
  expect(await loaded.status()).toEqual({ kind: "launchd", installed: true, loaded: true, file: PLIST() });
  const nowhere = createServiceManager(fakeHost("linux", { "systemctl --user show-environment": { code: 1 } }));
  expect(await nowhere.status()).toEqual({ kind: null, installed: false, loaded: false, file: UNIT() });
});
