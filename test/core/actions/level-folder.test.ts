import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { copyEnvFiles } from "../../../src/core/actions/create/copy-env-files.js";
import { copyFiles } from "../../../src/core/actions/create/copy-files.js";
import { detectInstall } from "../../../src/core/actions/create/detect-install.js";
import { levelFolder } from "../../../src/core/actions/create/level-folder.js";
import { slugOf } from "../../../src/core/actions/create/slug-of.js";
import { readConfig } from "../../../src/core/config/read-config.js";
import { groveHome } from "../../../src/core/grove-home.js";
import { appCommand } from "../../../src/core/open/app-command.js";
import { launchDetached } from "../../../src/core/open/launch-detached.js";

const savedHome = process.env["GIT_GROVE_HOME"];
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-grove-level-"));
});
afterAll(() => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
});

test("levelFolder puts a level under its feature's slug, numbered, with / as -", () => {
  expect(levelFolder("/r", "gift cards", 1, "feat/gift-cards-model")).toBe("/r/.worktrees/gift-cards/01-feat-gift-cards-model");
  expect(levelFolder("/r", "gift cards", 12, "ui")).toBe("/r/.worktrees/gift-cards/12-ui");
});

test("slugOf lowercases and collapses everything else to single dashes", () => {
  expect(slugOf("  Checkout: Coupons! ")).toBe("checkout-coupons");
});

test("appCommand defaults, and appends the path to a configured command", () => {
  const none = { editor: null, terminal: null };
  expect(appCommand("terminal", "/w", none, "darwin").argv).toEqual(["open", "-a", "Terminal", "/w"]);
  expect(appCommand("terminal", "/w", none, "linux")).toEqual({ argv: ["x-terminal-emulator"], cwd: "/w" });
  expect(appCommand("editor", "/w", none, "linux").argv).toEqual(["code", "/w"]);
  expect(appCommand("editor", "/w", { editor: ["cursor", "-n"], terminal: null }, "darwin").argv).toEqual(["cursor", "-n", "/w"]);
});

test("detectInstall maps each lockfile, in order, and gives null with none", async () => {
  const folder = await mkdtemp(join(tmpdir(), "git-grove-lock-"));
  expect(detectInstall(folder)).toBeNull();
  const cases: [string, string[]][] = [
    ["package-lock.json", ["npm", "install"]],
    ["bun.lockb", ["bun", "install"]],
    ["bun.lock", ["bun", "install"]],
    ["yarn.lock", ["yarn", "install"]],
    ["pnpm-lock.yaml", ["pnpm", "install"]],
  ];
  for (const [file, argv] of cases) {
    await writeFile(join(folder, file), "");
    expect(detectInstall(folder)?.argv).toEqual(argv);
  }
});

test("groveHome and readConfig follow GIT_GROVE_HOME; a missing or bad file gives nulls", async () => {
  const home = await mkdtemp(join(tmpdir(), "git-grove-cfg-"));
  process.env["GIT_GROVE_HOME"] = home;
  expect(groveHome()).toBe(home);
  expect(await readConfig()).toEqual({ editor: null, terminal: null });
  await writeFile(join(home, "config.json"), "{ not json");
  expect(await readConfig()).toEqual({ editor: null, terminal: null });
  await writeFile(join(home, "config.json"), JSON.stringify({ editor: ["cursor", "-n"], terminal: 7 }));
  expect(await readConfig()).toEqual({ editor: ["cursor", "-n"], terminal: null });
});

test("launchDetached rejects with a hint when the command does not exist", async () => {
  await expect(launchDetached({ argv: ["git-grove-no-such-editor", "/w"], cwd: dir })).rejects.toThrow(
    "git-grove-no-such-editor not found; set it in ~/.git-grove/config.json",
  );
});

test("copyFiles and copyEnvFiles create folders and never overwrite", async () => {
  const main = await mkdtemp(join(tmpdir(), "git-grove-main-"));
  const target = await mkdtemp(join(tmpdir(), "git-grove-target-"));
  await mkdir(join(main, "apps/web"), { recursive: true });
  await writeFile(join(main, ".env"), "main\n");
  await writeFile(join(main, "apps/web/.env.local"), "web\n");
  await writeFile(join(target, ".env"), "mine\n");
  const result = await copyEnvFiles(main, target, [".env", "apps/web/.env.local"]);
  expect(result).toEqual({ copied: ["apps/web/.env.local"], kept: [".env"] });
  const direct = await copyFiles([{ from: join(main, ".env"), to: join(target, ".env") }], { overwrite: false });
  expect(direct).toEqual({ copied: [], kept: [join(target, ".env")] });
  await expect(copyFiles([{ from: join(main, "gone"), to: join(target, "gone") }], { overwrite: false })).rejects.toThrow();
});
