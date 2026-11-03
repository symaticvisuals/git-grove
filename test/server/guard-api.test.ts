import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createGuardInstaller } from "../../src/server/guard/guard-installer.js";
import type { GuardSetup } from "../../src/server/guard/guard-setup.types.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { makeRepo } from "../support/make-repo.js";
import { serverRequest } from "../support/server-request.js";
import { type UiFixture, uiFixture } from "../support/ui-fixture.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(ROOT, "dist", "cli", "bin.js");
const NPX_BIN = "/Users/robin/.npm/_npx/4f1e/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js";

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

let home: string;
let claude: string;
let settingsPath: string;
let ui: UiFixture;
let server: RunningServer | undefined;
const savedHome = process.env["GIT_GROVE_HOME"];

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Json {
  if (!isRecord(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

function first(value: unknown): unknown {
  if (!Array.isArray(value)) throw new Error("expected an array");
  const items: unknown[] = value;
  return items[0];
}

function live(): RunningServer {
  if (server === undefined) throw new Error("no server started");
  return server;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected a string");
  return value;
}

async function start(setup: Partial<GuardSetup> | null = {}): Promise<void> {
  const guard = setup === null ? undefined : () => ({ node: process.execPath, bin: BIN, settingsPath, home, ...setup });
  server = await startServer({ port: 0, home, uiDir: ui.dir, version: "9.9.9", watch: { debounceMs: 30, pollMs: 60_000 }, ...(guard === undefined ? {} : { guard }) });
}

async function call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = { "x-grove-token": live().token }): Promise<Reply> {
  const json: Record<string, string> = method === "POST" ? { "content-type": "application/json" } : {};
  const reply = await serverRequest(live().port, { method, path, headers: { ...json, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: reply.status, body: record(JSON.parse(reply.body)) };
}

async function plan(change: "install" | "uninstall"): Promise<{ planId: string; plan: Json }> {
  const reply = await call("POST", "/api/guard/plans", { change });
  expect(reply.status).toBe(200);
  return { planId: text(reply.body["planId"]), plan: record(reply.body["plan"]) };
}

async function runPlan(planId: string): Promise<Reply> {
  return call("POST", "/api/guard/actions", { planId });
}

async function settings(): Promise<unknown> {
  return JSON.parse(await readFile(settingsPath, "utf8"));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-guard-api-"));
  claude = await mkdtemp(join(tmpdir(), "git-grove-claude-"));
  settingsPath = join(claude, ".claude", "settings.json");
  process.env["GIT_GROVE_HOME"] = home;
  ui = await uiFixture();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
  await rm(claude, { recursive: true, force: true });
  await ui.cleanup();
});

test("read, plan, install, read again, then undo the install by an uninstall planned against the file as it is", async () => {
  await start();
  const command = `${process.execPath} ${BIN} guard --claude`;
  await mkdir(join(claude, ".claude"));
  await writeFile(settingsPath, '{\n  "model": "opus"\n}\n');
  expect((await call("GET", "/api/guard")).body).toEqual({
    status: "absent",
    settingsPath,
    command,
    hooksDisabled: false,
    refusal: null,
  });
  const install = await plan("install");
  expect(install.plan).toMatchObject({ change: "install", confirm: "Install", settingsPath, backupPath: `${settingsPath}.grove-backup`, blockers: [] });
  const ran = await runPlan(install.planId);
  expect(ran.status).toBe(200);
  expect(record(ran.body["receipt"])).toMatchObject({ change: "install", ok: true, title: "Installed the agent guard", undo: "uninstall" });
  expect(await settings()).toEqual({ model: "opus", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command, timeout: 10 }] }] } });
  expect(await readFile(`${settingsPath}.grove-backup`, "utf8")).toBe('{\n  "model": "opus"\n}\n');
  expect((await call("GET", "/api/guard")).body["status"]).toBe("installed");

  await writeFile(settingsPath, (await readFile(settingsPath, "utf8")).replace('"model": "opus",', '"model": "opus",\n  "theme": "dark",'));
  const undo = await plan("uninstall");
  expect((await runPlan(undo.planId)).body["receipt"]).toMatchObject({ ok: true, title: "Uninstalled the agent guard", undo: "install" });
  expect(await settings()).toEqual({ model: "opus", theme: "dark" });
  expect((await call("GET", "/api/guard")).body["status"]).toBe("absent");
});

test("a plan runs once: the second run is a 409, and an unknown plan a 410", async () => {
  await start();
  const { planId } = await plan("install");
  expect((await runPlan(planId)).status).toBe(200);
  expect(await runPlan(planId)).toEqual({ status: 409, body: { error: "This plan already ran" } });
  expect((await runPlan("nope")).status).toBe(410);
  expect((await call("POST", "/api/guard/plans", { change: "everything" })).status).toBe(400);
});

test("an expired guard plan cannot run", async () => {
  let clock = 0;
  const installer = createGuardInstaller(() => ({ node: process.execPath, bin: BIN, settingsPath, home }), { ttlMs: 100, now: () => clock });
  const { planId } = await installer.plan("install");
  clock = 200;
  await expect(installer.run(planId)).rejects.toMatchObject({ status: 410 });
  await expect(readFile(settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("the guard routes need the token, a same-origin change and a JSON body, like every other route", async () => {
  await start();
  expect((await call("GET", "/api/guard", undefined, {})).status).toBe(401);
  expect((await call("POST", "/api/guard/plans", { change: "install" }, {})).status).toBe(401);
  const { planId } = await plan("install");
  expect((await call("POST", "/api/guard/actions", { planId }, { "x-grove-token": live().token, origin: "http://evil.example" })).status).toBe(403);
  expect((await call("POST", "/api/guard/actions", { planId }, { "x-grove-token": "f".repeat(64) })).status).toBe(401);
  await expect(readFile(settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("the guard routes answer only a loopback Host", async () => {
  await start();
  expect((await call("GET", "/api/guard", undefined, { "x-grove-token": live().token, host: "evil.example" })).status).toBe(421);
  expect((await call("POST", "/api/guard/plans", { change: "install" }, { "x-grove-token": live().token, host: `evil.example:${live().port}` })).status).toBe(421);
});

test("two changes run at once are made one at a time: the second sees the file changed and is refused, and one hook is written", async () => {
  await start();
  const [one, two] = [await plan("install"), await plan("install")];
  const receipts = await Promise.all([runPlan(one.planId), runPlan(two.planId)]);
  expect(receipts.map((reply) => record(reply.body["receipt"])["title"]).sort()).toEqual(["Changed since you looked", "Installed the agent guard"]);
  const written = record(await settings());
  expect(record(first(record(written["hooks"])["PreToolUse"]))["matcher"]).toBe("Bash");
  expect(record(written["hooks"])["PreToolUse"]).toHaveLength(1);
});

test("a read-only settings file is reported with grove's refusal, and its status is still read", async () => {
  await start();
  await mkdir(join(claude, ".claude"));
  await writeFile(settingsPath, "{}\n");
  await chmod(settingsPath, 0o444);
  expect((await call("GET", "/api/guard")).body).toMatchObject({
    status: "absent",
    refusal: `grove will not edit ${settingsPath}: it is read-only. To add the hook yourself, run git grove install-guard.`,
  });
});

test("from a package runner's cache the state and the plan carry install-guard's refusal, and nothing is written", async () => {
  await start({ bin: NPX_BIN });
  const state = (await call("GET", "/api/guard")).body;
  expect(text(state["refusal"])).toContain("a package runner's cache (npx, pnpm dlx, bunx, yarn dlx)");
  expect(text(state["refusal"])).toContain("npm i -g @deepanshugoel/git-grove");
  const install = await plan("install");
  expect(install.plan["blockers"]).toEqual([state["refusal"]]);
  expect(record((await runPlan(install.planId)).body["receipt"])).toMatchObject({ ok: false, refused: true, title: "Not run" });
  await expect(readFile(settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("a settings file grove cannot parse is unreadable, and grove says it will not edit it", async () => {
  await start();
  await mkdir(join(claude, ".claude"));
  await writeFile(settingsPath, "// mine\n{}\n");
  const state = (await call("GET", "/api/guard")).body;
  expect(state).toMatchObject({ status: "unreadable", refusal: expect.stringMatching(/^grove will not edit .*settings\.json: it is not valid JSON/) });
  expect((await plan("install")).plan["blockers"]).toEqual([expect.stringContaining("To add the hook yourself, run git grove install-guard.")]);
});

test("a server started without a guard setup answers the guard routes with 503", async () => {
  await start(null);
  expect(await call("GET", "/api/guard")).toEqual({ status: 503, body: { error: "This git grove server cannot install the agent guard" } });
});

function sh(command: string, stdin: string, cwd: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { cwd, env: { ...process.env, GIT_GROVE_HOME: home, HOME: claude } });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(stdin);
  });
}

test("the command an install writes, run by sh as Claude Code runs it, blocks removing the demo's precious worktree with exit 2", async () => {
  await start();
  const repo = await makeRepo();
  try {
    const root = await realpath(repo.path);
    await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
    await repo.commit("README.md", "acme-shop\n", "start acme-shop");
    const old = join(root, ".worktrees", "old-onboarding");
    await repo.worktree(old, "feat/onboarding-copy");
    await mkdir(join(old, ".local"));
    await writeFile(join(old, ".local", "seed.sql"), "insert into coupons values ('WELCOME10', 10);\n");

    const { planId } = await plan("install");
    expect((await runPlan(planId)).status).toBe(200);
    const written = record(await settings());
    const group = record(first(record(written["hooks"])["PreToolUse"]));
    const command = text(record(first(group["hooks"]))["command"]);
    const hook = JSON.stringify({ session_id: "proof", cwd: root, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git worktree remove --force .worktrees/old-onboarding" } });
    const result = await sh(command, hook, root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(".local/seed.sql");
    expect(result.stderr).toContain("git grove rm --rescue .worktrees/old-onboarding");
  } finally {
    await repo.cleanup();
  }
});
