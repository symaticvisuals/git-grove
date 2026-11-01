import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ActionContext } from "../../../src/core/actions/action.types.js";
import { prepareAction } from "../../../src/core/actions/registry.js";
import { runPrepared } from "../../../src/core/actions/run-prepared.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

const gate = vi.hoisted(() => ({ configWrites: 0, failOn: 0 }));

vi.mock("../../../src/core/git/run-git.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../src/core/git/run-git.js")>();
  return {
    ...actual,
    runGit: (args: string[], options: Parameters<typeof actual.runGit>[1]) => {
      if (args[0] === "config" && options.write === true && ++gate.configWrites === gate.failOn) {
        return Promise.reject(new Error("config write failed"));
      }
      return actual.runGit(args, options);
    },
  };
});

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let store: Store;
let ctx: ActionContext;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  repo = await makeRepo();
  store = openStore();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
  ctx = { root: repo.path, store, now: () => Date.now() };
});
afterEach(async () => {
  gate.configWrites = 0;
  gate.failOn = 0;
  store.close();
  await repo.cleanup();
});

test("a record that fails on its second key names the key written and how to undo it", async () => {
  const prepared = await prepareAction("new", ctx, { feature: "gift cards", branch: "feat/gift-cards-model" });
  gate.failOn = 2;
  const receipt = await runPrepared(ctx, prepared, () => undefined);
  expect(receipt.ok).toBe(false);
  expect(receipt.lines).toContain("  config branch.feat/gift-cards-model.stackparent");
  const unset = "git config --unset branch.feat/gift-cards-model.stackparent";
  expect(receipt.lines).toContain(`  ${unset}`);
  expect(receipt.lines.some((line) => line.includes("stackforkpoint"))).toBe(false);
  const commands = receipt.lines.filter((line) => line.startsWith("  git "));
  expect(commands.findIndex((line) => line.includes(unset))).toBeLessThan(commands.findIndex((line) => line.includes("git branch -D")));
});
