import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type ServiceSubcommand, serviceCommand } from "../../src/cli/commands/service.js";
import type { ServiceHost } from "../../src/core/service/service-host.js";
import { createServiceManager } from "../../src/core/service/service-manager.js";
import { startServer } from "../../src/server/start-server.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const BIN = "/opt/grove/dist/cli/bin.js";
const savedHome = process.env["GIT_GROVE_HOME"];

let userHome: string;
let groveHome: string;

beforeEach(async () => {
  userHome = await mkdtemp(join(tmpdir(), "git-grove-user-"));
  groveHome = join(userHome, "grove-home");
  process.env["GIT_GROVE_HOME"] = groveHome;
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(userHome, { recursive: true, force: true });
});

function host(platform: NodeJS.Platform, failing: string[] = []): ServiceHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    platform,
    home: userHome,
    uid: 501,
    path: "/usr/bin:/bin",
    calls,
    async run(cmd, args) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      return failing.some((prefix) => line.startsWith(prefix)) ? { code: 1, stdout: "", stderr: "Failed to connect to bus: No medium found\n" } : { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function service(sub: ServiceSubcommand, fake: ServiceHost, bin = BIN): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await serviceCommand({ out: (s) => out.push(s), err: (s) => err.push(s), cwd: userHome }, sub, { service: createServiceManager(fake), bin });
  return { code, out: out.join(""), err: err.join("") };
}

test("service install with no launchd or systemd explains, exits 1 and writes nothing", async () => {
  const fake = host("linux", ["systemctl --user show-environment"]);
  const result = await service("install", fake);
  expect(result).toEqual({
    code: 1,
    out: "",
    err: "git-grove: no launchd or systemd user session here (systemctl --user: Failed to connect to bus: No medium found); run git grove serve yourself\n",
  });
  expect(await readdir(userHome)).toEqual([]);
  expect(fake.calls).toEqual(["systemctl --user show-environment"]);
});

test("service install from an npx cache refuses and touches nothing", async () => {
  const fake = host("darwin");
  const result = await service("install", fake, "/Users/me/.npm/_npx/abc/node_modules/git-grove/dist/cli/bin.js");
  expect(result.code).toBe(1);
  expect(result.err).toContain("npm i -g git-grove");
  expect(fake.calls).toEqual([]);
  expect(await readdir(userHome)).toEqual([]);
});

test("service install writes and loads the agent, creates grove's folder for its log, and says how to remove it", async () => {
  const fake = host("darwin");
  const plist = join(userHome, "Library", "LaunchAgents", "work.grove.server.plist");
  const result = await service("install", fake);
  expect(result).toEqual({ code: 0, out: `Installed a login service: ${plist}\nRemove it with: git grove service uninstall\n`, err: "" });
  expect(existsSync(plist)).toBe(true);
  expect(existsSync(groveHome)).toBe(true);
  expect(fake.calls).toContain(`launchctl bootstrap gui/501 ${plist}`);
});

test("a load that fails exits 1 with one line, leaving no agent", async () => {
  const fake = host("darwin", ["launchctl bootstrap", "launchctl bootout"]);
  const result = await service("install", fake);
  expect(result.code).toBe(1);
  expect(result.err).toMatch(/^git-grove: launchctl bootstrap gui\/501 \S+ failed \(exit 1\): Failed to connect to bus: No medium found\n$/);
  expect(existsSync(join(userHome, "Library", "LaunchAgents", "work.grove.server.plist"))).toBe(false);
});

test("service uninstall removes the agent, then says there is none", async () => {
  const fake = host("darwin");
  await service("install", fake);
  const plist = join(userHome, "Library", "LaunchAgents", "work.grove.server.plist");
  expect(await service("uninstall", fake)).toEqual({ code: 0, out: `Removed the login service: ${plist}\n`, err: "" });
  expect(await service("uninstall", fake)).toEqual({ code: 0, out: "No login service was installed\n", err: "" });
});

test("service status says what is installed and where the dashboard runs", async () => {
  const fake = host("linux", ["systemctl --user is-active"]);
  expect((await service("status", fake)).out).toBe(
    "Login service: not installed (systemd); install it with: git grove service install\nDashboard: not running\n",
  );
  await service("install", fake);
  const server = await startServer({ port: 0, home: groveHome, version: "1.2.3" });
  try {
    const unit = join(userHome, ".config", "systemd", "user", "git-grove.service");
    expect((await service("status", fake)).out).toBe(`Login service: systemd, not loaded, ${unit}\nDashboard: http://127.0.0.1:${server.port}/ (git grove 1.2.3)\n`);
  } finally {
    await server.close();
  }
  const nowhere = host("linux", ["systemctl --user show-environment"]);
  expect((await service("status", nowhere)).out).toBe("Login service: none; this machine has no launchd or systemd user session\nDashboard: not running\n");
});
