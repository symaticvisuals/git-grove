import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type UiDeps, uiCommand } from "../../src/cli/commands/ui.js";
import { run } from "../../src/cli/main.js";
import { packageVersion } from "../../src/cli/package-version.js";
import type { Plan } from "../../src/core/actions/plan.types.js";
import { openStore } from "../../src/core/journal/open-store.js";
import { ServiceFailedError } from "../../src/core/service/service-failed.error.js";
import type { ServiceHost } from "../../src/core/service/service-host.js";
import { createServiceManager, type ServiceKind, type ServiceManager } from "../../src/core/service/service-manager.js";
import type { ServiceProgram } from "../../src/core/service/service-program.types.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { featureId } from "../../src/server/wire/feature-id.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";
import { makeStack } from "../support/make-stack.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const BIN = "/opt/grove/dist/cli/bin.js";
const saved = { home: process.env["GIT_GROVE_HOME"], noOpen: process.env["GIT_GROVE_NO_OPEN"] };

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

let home: string;
let servers: RunningServer[];
let repos: TestRepo[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-ui-"));
  process.env["GIT_GROVE_HOME"] = home;
  delete process.env["GIT_GROVE_NO_OPEN"];
  servers = [];
  repos = [];
});
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(repos.map((repo) => repo.cleanup()));
  restore("GIT_GROVE_HOME", saved.home);
  restore("GIT_GROVE_NO_OPEN", saved.noOpen);
  await rm(home, { recursive: true, force: true });
});

async function serve(version = packageVersion(), onShutdown?: (code: number) => void): Promise<RunningServer> {
  const server = await startServer({ port: 0, home, version, ...(onShutdown === undefined ? {} : { onShutdown }) });
  servers.push(server);
  return server;
}

type FakeService = ServiceManager & { calls: string[]; programs: ServiceProgram[] };

function fakeService(options: { kind: ServiceKind | null; installed?: boolean; onInstall?: () => Promise<void>; onStart?: () => Promise<void> }): FakeService {
  const calls: string[] = [];
  const programs: ServiceProgram[] = [];
  const file = join(home, "Library", "LaunchAgents", "work.grove.server.plist");
  return {
    calls,
    programs,
    async support() {
      calls.push("support");
      return options.kind;
    },
    async install(program) {
      calls.push("install");
      programs.push(program);
      await options.onInstall?.();
      return { wrote: file, removeWith: "git grove service uninstall" };
    },
    async uninstall() {
      calls.push("uninstall");
      return { removed: null };
    },
    async start() {
      calls.push("start");
      await options.onStart?.();
    },
    async status() {
      calls.push("status");
      const installed = options.installed ?? false;
      return { kind: options.kind, installed, loaded: false, file, program: installed ? { node: process.execPath, bin: BIN, groveHome: home, nodeExists: true } : null };
    },
  };
}

type Harness = { deps: UiDeps; opened: string[]; foreground: { port: number; token: string }[] };

function harness(service: ServiceManager, overrides: Partial<UiDeps> = {}): Harness {
  const opened: string[] = [];
  const foreground: { port: number; token: string }[] = [];
  const deps: UiDeps = {
    service,
    openUrl: async (url) => {
      opened.push(url);
      return true;
    },
    serveForeground: async () => {
      const running = { port: 40_001, token: "f".repeat(64) };
      foreground.push(running);
      return running;
    },
    bin: BIN,
    waitMs: 300,
    ...overrides,
  };
  return { deps, opened, foreground };
}

async function ui(deps: UiDeps, cwd: string): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await uiCommand({ out: (s) => out.push(s), err: (s) => err.push(s), cwd }, deps);
  return { code, out: out.join(""), err: err.join("") };
}

function routeOf(url: string): { token: string | null; route: string | null } {
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  return { token: params.get("token"), route: params.get("route") };
}

async function stackRepo(): Promise<{ repo: TestRepo; paths: Record<string, string> }> {
  const repo = await makeRepo();
  repos.push(repo);
  await repo.commit("base.txt", "base\n", "base");
  const paths = await makeStack(repo, {
    feature: "coupons",
    levels: [
      { branch: "feat/coupons-model", parent: "main", file: "model.ts" },
      { branch: "feat/coupons-ui", parent: "feat/coupons-model", file: "ui.ts" },
    ],
  });
  return { repo, paths };
}

function registeredRepoId(root: string): number | null {
  const store = openStore(join(home, "grove.db"));
  try {
    return store.repos().find((repo) => repo.root === root)?.id ?? null;
  } finally {
    store.close();
  }
}

test("with a server running, ui opens its URL at the current worktree's feature and installs nothing", async () => {
  const { repo, paths } = await stackRepo();
  const server = await serve();
  const service = fakeService({ kind: "launchd" });
  const run = harness(service);
  const inside = join(paths["feat/coupons-ui"] ?? "", "src");
  await mkdir(inside);
  const result = await ui(run.deps, inside);
  expect(result.code).toBe(0);
  const repoId = registeredRepoId(await realpath(repo.path));
  expect(repoId).not.toBeNull();
  expect(run.opened).toHaveLength(1);
  expect(routeOf(run.opened[0] ?? "")).toEqual({ token: server.token, route: `/r/${repoId}/f/${featureId(repoId ?? 0, "coupons")}` });
  expect(run.opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${server.port}/#token=`));
  expect(service.calls).not.toContain("install");
  expect(service.calls).not.toContain("start");
  expect(run.foreground).toHaveLength(0);
  expect(result.out).toBe(`Opened the dashboard at http://127.0.0.1:${server.port}/\n`);
});

test("in the trunk's worktree ui opens the repository", async () => {
  const { repo } = await stackRepo();
  await serve();
  const run = harness(fakeService({ kind: null }));
  await ui(run.deps, repo.path);
  const repoId = registeredRepoId(await realpath(repo.path));
  expect(routeOf(run.opened[0] ?? "").route).toBe(`/r/${repoId}`);
});

test("outside a repository ui opens the projects page", async () => {
  await serve();
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    const run = harness(fakeService({ kind: null }));
    expect((await ui(run.deps, outside)).code).toBe(0);
    expect(routeOf(run.opened[0] ?? "").route).toBe("/");
    expect(run.opened[0]).toMatch(/&route=%2F$/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("with no server and no service support, ui serves in the foreground and says so", async () => {
  const run = harness(fakeService({ kind: null }));
  const result = await ui(run.deps, home);
  expect(result.code).toBe(0);
  expect(run.foreground).toHaveLength(1);
  expect(result.out).toContain("foreground");
  expect(result.out).toContain("Serving in the foreground; press Ctrl-C to stop");
  expect(routeOf(run.opened[0] ?? "").token).toBe("f".repeat(64));
  expect(run.opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:40001\//);
});

test("with no server and an uninstalled service, ui installs it and prints the file and how to remove it", async () => {
  const started: RunningServer[] = [];
  const service = fakeService({ kind: "launchd", onInstall: async () => void started.push(await serve()) });
  const run = harness(service);
  const result = await ui(run.deps, home);
  expect(result.code).toBe(0);
  const plist = join(home, "Library", "LaunchAgents", "work.grove.server.plist");
  expect(result.out).toContain(`Installed a login service: ${plist}\nRemove it with: git grove service uninstall\n`);
  expect(service.programs).toEqual([{ node: process.execPath, bin: BIN, groveHome: home, path: process.env["PATH"], logFile: join(home, "server.log") }]);
  expect(run.foreground).toHaveLength(0);
  expect(started).toHaveLength(1);
  expect(run.opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${started[0]?.port ?? 0}/`));
});

const OFFER_GUARD = "Protect your worktrees from Claude Code: use Install on the dashboard, or run git grove install-guard.\n";

test("the run that installs the login service, with the agent guard absent, prints one line pointing to the dashboard's Install", async () => {
  const service = fakeService({ kind: "launchd", onInstall: async () => void (await serve()) });
  const result = await ui(harness(service, { guardStatus: async () => "absent" }).deps, home);
  expect(result.out).toContain(`Remove it with: git grove service uninstall\n${OFFER_GUARD}`);
  expect(result.out.split(OFFER_GUARD)).toHaveLength(2);
});

test("the guard line is not printed when the guard is installed, stale or unreadable, or when the service was already installed", async () => {
  for (const status of ["installed", "stale", "unreadable"] as const) {
    const service = fakeService({ kind: "launchd", onInstall: async () => void (await serve()) });
    expect((await ui(harness(service, { guardStatus: async () => status }).deps, home)).out, status).not.toContain(OFFER_GUARD);
    await Promise.all(servers.splice(0).map((server) => server.close()));
  }
  const started = fakeService({ kind: "launchd", installed: true, onStart: async () => void (await serve()) });
  expect((await ui(harness(started, { guardStatus: async () => "absent" }).deps, home)).out).not.toContain(OFFER_GUARD);
});

test("with no server and an installed service that is not running, ui starts it", async () => {
  const service = fakeService({ kind: "systemd", installed: true, onStart: async () => void (await serve()) });
  const run = harness(service);
  const result = await ui(run.deps, home);
  expect(result.code).toBe(0);
  expect(service.calls).toContain("start");
  expect(service.calls).not.toContain("install");
  expect(run.foreground).toHaveLength(0);
  expect(result.out).not.toContain("foreground");
});

test("a service that does not answer in time is reported, and ui serves in the foreground", async () => {
  const service = fakeService({ kind: "launchd", installed: true });
  const run = harness(service);
  const result = await ui(run.deps, home);
  expect(service.calls).toContain("start");
  expect(result.err).toBe(`git-grove: the login service has not started git grove yet; its log is ${join(home, "server.log")}\n`);
  expect(run.foreground).toHaveLength(1);
});

test("a bin under an npx cache never installs the service", async () => {
  const service = fakeService({ kind: "launchd" });
  const run = harness(service, { bin: "/x/_npx/1/node_modules/git-grove/dist/cli/bin.js" });
  const result = await ui(run.deps, home);
  expect(service.calls).not.toContain("install");
  expect(service.calls).not.toContain("start");
  expect(run.foreground).toHaveLength(1);
  expect(result.out).toContain("npm i -g @deepanshugoel/git-grove");
  expect(result.out).toContain("Serving in the foreground; press Ctrl-C to stop");
});

test("a service that fails to install says why and serves in the foreground", async () => {
  const service = fakeService({ kind: "launchd" });
  service.install = async () => {
    throw new ServiceFailedError("launchctl bootstrap gui/501 x.plist", 5, "Bootstrap failed: 5: Input/output error");
  };
  const run = harness(service);
  const result = await ui(run.deps, home);
  expect(result.err).toBe("git-grove: launchctl bootstrap gui/501 x.plist failed (exit 5): Bootstrap failed: 5: Input/output error\n");
  expect(run.foreground).toHaveLength(1);
});

test("with no service, a running server older than this CLI is asked to exit, and ui starts as soon as it has", async () => {
  const codes: number[] = [];
  await serve("0.0.1", (code) => codes.push(code));
  const run = harness(fakeService({ kind: null }), { restartWaitMs: 20_000 });
  const startedAt = Date.now();
  const result = await ui(run.deps, home);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(codes).toEqual([75]);
  expect(result.out).toContain(`Restarting git grove 0.0.1 as ${packageVersion()}`);
  expect(run.foreground).toHaveLength(1);
});

test("with no service, an older server still finishing a run after the wait is opened, and ui says so", async () => {
  const old = await serve("0.0.1");
  const repo = await makeRepo();
  repos.push(repo);
  await repo.commit("base.txt", "base\n", "base");
  const commonDir = (await repo.git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
  const repoId = old.context.store.repoId(commonDir, repo.path);
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const plan: Plan = {
    action: "ack",
    context: "test",
    title: "Held",
    summary: "",
    confirm: "Go",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: [],
    steps: [{ title: "Check nothing moved since you looked", detail: "" }],
    blockers: [],
    note: null,
    undoable: false,
    moves: [],
    expects: [],
    readAt: Date.now(),
  };
  const runId = old.context.runs.start(repoId, repo.path, { plan, execute: async () => (await gate, { ok: true, title: "Held", lines: [], undo: null }) });
  await vi.waitFor(() => expect(old.context.runs.get(runId)?.events).toContainEqual(expect.objectContaining({ index: 0, state: "done" })), { timeout: 10_000 });
  try {
    const run = harness(fakeService({ kind: null }), { restartWaitMs: 300 });
    const result = await ui(run.deps, home);
    expect(result.out).toContain("git grove 0.0.1 is still finishing a run; opening it\n");
    expect(result.out).not.toContain("Restarting");
    expect(run.opened.map((url) => new URL(url).port)).toEqual([String(old.port)]);
    expect(run.foreground).toEqual([]);
  } finally {
    finish();
  }
});

test("a running server as new as this CLI, or newer, is left alone", async () => {
  const codes: number[] = [];
  const server = await serve("99.0.0", (code) => codes.push(code));
  const run = harness(fakeService({ kind: "launchd" }));
  await ui(run.deps, home);
  expect(codes).toEqual([]);
  expect(routeOf(run.opened[0] ?? "").token).toBe(server.token);
});

test("with GIT_GROVE_NO_OPEN=1 the address is printed, not opened", async () => {
  process.env["GIT_GROVE_NO_OPEN"] = "1";
  const server = await serve();
  const run = harness(fakeService({ kind: "launchd" }));
  const result = await ui(run.deps, home);
  expect(run.opened).toEqual([]);
  expect(result.out).toBe(`Open the dashboard: http://127.0.0.1:${server.port}/#token=${server.token}&route=%2F\n`);
});

test("when the browser cannot be opened, the address is printed", async () => {
  const server = await serve();
  const run = harness(fakeService({ kind: "launchd" }), { openUrl: async () => false });
  const result = await ui(run.deps, home);
  expect(result.out).toContain(`Open the dashboard: http://127.0.0.1:${server.port}/#token=${server.token}`);
});

test("git grove with no arguments runs ui, and ui takes no arguments", async () => {
  const server = await serve();
  const run1 = harness(fakeService({ kind: "launchd" }));
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd: home };
  expect(await run([], io, () => run1.deps)).toBe(0);
  expect(out.join("")).toBe(`Opened the dashboard at http://127.0.0.1:${server.port}/\n`);
  for (const argv of [["ui", "extra"], ["ui", "--json"], ["--json"], ["service"], ["service", "start"], ["service", "status", "x"]]) {
    err.length = 0;
    expect(await run(argv, io, () => run1.deps), argv.join(" ")).toBe(1);
    expect(err.join(""), argv.join(" ")).toContain("Usage: git grove");
  }
  expect(run1.opened).toHaveLength(1);
});

/** What the fake launchd runs: the version its job starts, how many more bootstraps fail, and each exit code it saw. */
type LaunchdState = { version: string; failBootstraps: number; exits: number[] };

/**
 * A macOS host on a temp home whose runner records commands and acts as launchd would: unloading the agent stops its
 * server, loading it starts one at `state.version`, and a server that exits non-zero is started again (KeepAlive).
 */
function launchdHost(calls: string[], state: LaunchdState = { version: packageVersion(), failBootstraps: 0, exits: [] }): ServiceHost {
  const start = async (): Promise<void> => {
    await serve(state.version, (code) => {
      state.exits.push(code);
      if (code !== 0) void start();
    });
  };
  return {
    platform: "darwin",
    home,
    uid: 501,
    path: "/usr/bin:/bin",
    async run(cmd, args) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      if (line.startsWith("launchctl bootout")) await Promise.all(servers.splice(0).map((server) => server.close()));
      if (line.startsWith("launchctl bootstrap") && state.failBootstraps > 0) {
        state.failBootstraps -= 1;
        return { code: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error\n" };
      }
      if (line.startsWith("launchctl bootstrap")) await start();
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

const PLIST = (): string => join(home, "Library", "LaunchAgents", "work.grove.server.plist");

test("an installed service that runs another copy of git grove is rewritten to this one and reloaded", async () => {
  const calls: string[] = [];
  const service = createServiceManager(launchdHost(calls));
  await service.install({ node: process.execPath, bin: "/old/copy/dist/cli/bin.js", groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  const old = servers[0];
  calls.length = 0;
  const run = harness(service);
  const result = await ui(run.deps, home);
  expect(result.out).toContain("Updated the login service to this copy of git grove\n");
  expect(await readFile(PLIST(), "utf8")).toContain(`<string>${BIN}</string>`);
  expect(calls).toContain("launchctl bootout gui/501/work.grove.server");
  expect(calls).toContain(`launchctl bootstrap gui/501 ${PLIST()}`);
  expect(run.foreground).toHaveLength(0);
  expect(servers).toHaveLength(1);
  expect(servers[0]).not.toBe(old);
  expect(run.opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${servers[0]?.port ?? 0}/`));
  expect(result.err).toBe("");
});

test("an installed service whose Node is gone is rewritten to this Node", async () => {
  const calls: string[] = [];
  const service = createServiceManager(launchdHost(calls));
  const gone = join(home, "node-gone", "node");
  await mkdir(dirname(gone), { recursive: true });
  await writeFile(gone, "");
  await service.install({ node: gone, bin: BIN, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  await rm(dirname(gone), { recursive: true });
  calls.length = 0;
  const result = await ui(harness(service).deps, home);
  expect(result.err).toBe("");
  expect(result.out).toContain("Updated the login service to this copy of git grove\n");
  expect(await readFile(PLIST(), "utf8")).toContain(`<string>${process.execPath}</string>`);
  expect(calls).toContain(`launchctl bootstrap gui/501 ${PLIST()}`);
});

test("an installed service that runs this copy and this Node is left alone", async () => {
  const calls: string[] = [];
  const service = createServiceManager(launchdHost(calls));
  await service.install({ node: process.execPath, bin: BIN, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  const before = await readFile(PLIST(), "utf8");
  calls.length = 0;
  const result = await ui(harness(service).deps, home);
  expect(result.out).not.toContain("Updated the login service");
  expect(calls.filter((call) => /bootout|bootstrap/.test(call))).toEqual([]);
  expect(await readFile(PLIST(), "utf8")).toBe(before);
});

test("an installed service that reads another Claude Code folder is rewritten to this shell's CLAUDE_CONFIG_DIR", async () => {
  const calls: string[] = [];
  const service = createServiceManager(launchdHost(calls));
  await service.install({ node: process.execPath, bin: BIN, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  calls.length = 0;
  process.env["CLAUDE_CONFIG_DIR"] = join(home, "claude-work");
  try {
    const result = await ui(harness(service).deps, home);
    expect(result.out).toContain("Updated the login service to this copy of git grove\n");
    expect(await readFile(PLIST(), "utf8")).toContain(`<key>CLAUDE_CONFIG_DIR</key>\n    <string>${join(home, "claude-work")}</string>`);
    expect(calls).toContain(`launchctl bootstrap gui/501 ${PLIST()}`);
  } finally {
    delete process.env["CLAUDE_CONFIG_DIR"];
  }
});

test("when the running server would install the agent guard into another settings file than this shell's, ui names both", async () => {
  const served = join(home, "server-claude", "settings.json");
  servers.push(await startServer({ port: 0, home, version: packageVersion(), guard: () => ({ node: process.execPath, bin: BIN, settingsPath: served }) }));
  const shell = join(home, "shell-claude", "settings.json");
  const result = await ui(harness(fakeService({ kind: "launchd" }), { claudeSettingsPath: shell }).deps, home);
  expect(result.out).toContain(`The dashboard installs the agent guard into ${served}, but Claude Code here reads ${shell}: the server and this shell differ in CLAUDE_CONFIG_DIR.\n`);
  const same = await ui(harness(fakeService({ kind: "launchd" }), { claudeSettingsPath: served }).deps, home);
  expect(same.out).not.toContain("installs the agent guard into");
});

test("from an npx cache, an installed service for another copy is left alone", async () => {
  const calls: string[] = [];
  const service = createServiceManager(launchdHost(calls));
  await service.install({ node: process.execPath, bin: "/old/copy/dist/cli/bin.js", groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  calls.length = 0;
  const result = await ui(harness(service, { bin: "/x/_npx/1/node_modules/git-grove/dist/cli/bin.js" }).deps, home);
  expect(result.out).not.toContain("Updated the login service");
  expect(calls.filter((call) => /bootout|bootstrap/.test(call))).toEqual([]);
});

const OTHER_COPY = "/old/copy/dist/cli/bin.js";

test("from npx, with the service on another copy, an older server is opened, not asked to exit, and ui says how to update it", async () => {
  const calls: string[] = [];
  const state: LaunchdState = { version: "0.0.1", failBootstraps: 0, exits: [] };
  const service = createServiceManager(launchdHost(calls, state));
  await service.install({ node: process.execPath, bin: OTHER_COPY, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  const old = servers[0];
  const run = harness(service, { bin: "/x/_npx/1/node_modules/git-grove/dist/cli/bin.js", restartWaitMs: 500 });
  const result = await ui(run.deps, home);
  expect(state.exits).toEqual([]);
  expect(servers).toEqual([old]);
  expect(routeOf(run.opened[0] ?? "").token).toBe(old?.token);
  expect(run.opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${old?.port ?? 0}/`));
  expect(result.out).toContain("The login service runs git grove 0.0.1. Run npm i -g @deepanshugoel/git-grove to update it.\n");
  expect(result.out).not.toContain("Restarting");
  expect(run.foreground).toHaveLength(0);
});

test("when rewriting the service fails, its old copy is put back and its older server is opened, not asked to exit", async () => {
  const calls: string[] = [];
  const state: LaunchdState = { version: "0.0.1", failBootstraps: 0, exits: [] };
  const service = createServiceManager(launchdHost(calls, state));
  await service.install({ node: process.execPath, bin: OTHER_COPY, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  state.failBootstraps = 2;
  const run = harness(service, { restartWaitMs: 500, waitMs: 2_000 });
  const result = await ui(run.deps, home);
  expect(result.err).toContain("launchctl bootstrap");
  expect(await readFile(PLIST(), "utf8")).toContain(`<string>${OTHER_COPY}</string>`);
  expect(state.exits.filter((code) => code === 75)).toEqual([]);
  expect(result.out).toContain("The login service runs git grove 0.0.1. Run npm i -g @deepanshugoel/git-grove to update it.\n");
  expect(run.opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${servers.at(-1)?.port ?? 0}/`));
});

test("with the service on this copy, an older server is asked to exit and the restart launchd makes is opened", async () => {
  const calls: string[] = [];
  const state: LaunchdState = { version: "0.0.1", failBootstraps: 0, exits: [] };
  const service = createServiceManager(launchdHost(calls, state));
  await service.install({ node: process.execPath, bin: BIN, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  const old = servers[0];
  state.version = packageVersion();
  calls.length = 0;
  const run = harness(service, { restartWaitMs: 5_000 });
  const result = await ui(run.deps, home);
  expect(state.exits).toEqual([75]);
  expect(result.out).toContain(`Restarting git grove 0.0.1 as ${packageVersion()}\n`);
  expect(calls.filter((call) => /bootout|bootstrap|kickstart/.test(call))).toEqual([]);
  const restarted = servers.at(-1);
  expect(restarted).not.toBe(old);
  expect(run.opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${restarted?.port ?? 0}/`));
  expect(run.foreground).toHaveLength(0);
});

test("when the service has not restarted an older server in time, ui starts the service", async () => {
  const calls: string[] = [];
  const state: LaunchdState = { version: "0.0.1", failBootstraps: 0, exits: [] };
  const service = createServiceManager(launchdHost(calls, state));
  await service.install({ node: process.execPath, bin: BIN, groveHome: home, path: "/usr/bin", logFile: join(home, "server.log") });
  servers[0]?.context.shutdown(0);
  await vi.waitFor(() => expect(state.exits).toEqual([0]), { timeout: 10_000 });
  await serve("0.0.1");
  state.version = packageVersion();
  calls.length = 0;
  const run = harness(service, { restartWaitMs: 300 });
  const result = await ui(run.deps, home);
  expect(result.out).toContain("Restarting git grove 0.0.1");
  expect(calls).toContain("launchctl kickstart gui/501/work.grove.server");
});

test("an installed service that uses another grove folder is rewritten to this one", async () => {
  const calls: string[] = [];
  const service = createServiceManager(launchdHost(calls));
  await service.install({ node: process.execPath, bin: BIN, groveHome: "/somewhere/else", path: "/usr/bin", logFile: "/somewhere/else/server.log" });
  const result = await ui(harness(service).deps, home);
  expect(result.out).toContain("Updated the login service to this copy of git grove\n");
  expect(await readFile(PLIST(), "utf8")).toContain(`<key>GIT_GROVE_HOME</key>\n    <string>${home}</string>`);
});
