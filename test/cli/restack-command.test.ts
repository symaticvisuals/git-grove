import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { run } from "../../src/cli/main.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";
import { makeStack } from "../support/make-stack.js";

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let paths: Record<string, string>;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

function folder(branch: string): string {
  const path = paths[branch];
  if (path === undefined) throw new Error(`no worktree for ${branch}`);
  return path;
}

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
  paths = await makeStack(repo, {
    feature: "checkout",
    levels: [
      { branch: "feat/model", parent: "main", file: "model.txt" },
      { branch: "feat/ui", parent: "feat/model", file: "ui.txt" },
      { branch: "feat/email", parent: "feat/ui", file: "email.txt" },
    ],
  });
  const model = folder("feat/model");
  await writeFile(join(model, "model-2.txt"), "model again\n");
  await repo.git("-C", model, "add", "model-2.txt");
  await repo.git("-C", model, "commit", "-m", "model again");
  Object.assign(
    paths,
    await makeStack(repo, { feature: "checkout", levels: [{ branch: "feat/admin", parent: "feat/model", file: "admin.txt" }] }),
  );
});
afterEach(() => repo.cleanup());

async function grove(argv: string[], cwd: string = repo.path): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd });
  return { code, out: out.join(""), err: err.join("") };
}

async function tips(): Promise<string[]> {
  return Promise.all(["feat/ui", "feat/email"].map(async (branch) => (await repo.git("rev-parse", branch)).trim()));
}

test("restack --dry-run prints the plan and changes nothing", async () => {
  const before = await tips();
  const result = await grove(["restack", "checkout", "--dry-run"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Restack checkout\n");
  expect(result.out).toContain("rebase --no-update-refs --no-autosquash --onto feat/model");
  expect(result.out).not.toContain("Restacked");
  expect(await tips()).toEqual(before);
});

test("restack runs and prints each step and the receipt", async () => {
  const result = await grove(["restack", "checkout"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("  ✓ Move feat/ui onto feat/model");
  expect(result.out).toContain("  ✓ Check nothing was lost");
  expect(result.out).toContain("Restacked 2 levels");
});

test("a blocked restack exits 3", async () => {
  await writeFile(join(folder("feat/ui"), "ui.txt"), "edited\n");
  const before = await tips();
  const result = await grove(["restack", "checkout"]);
  expect(result.code).toBe(3);
  expect(result.out).toContain("has uncommitted changes. Turn on set aside, or commit them first.");
  expect(await tips()).toEqual(before);
  expect((await grove(["restack", "checkout", "--stash"])).code).toBe(0);
});

test("stack plan <feature> --json prints the plan", async () => {
  const before = await tips();
  const result = await grove(["stack", "plan", "checkout", "--json"]);
  const doc: unknown = JSON.parse(result.out);
  expect(result.code).toBe(0);
  expect(doc).toMatchObject({ action: "restack", confirm: "Restack 2 levels" });
  expect(await tips()).toEqual(before);
});

test("restack accepts any branch of the feature", async () => {
  const result = await grove(["restack", "feat/email"], folder("feat/email"));
  expect(result.code).toBe(0);
  expect(result.out).toContain("Restacked 2 levels");
});

test("restack and stack plan with the wrong arguments exit 1 with usage", async () => {
  const wrong = [["restack"], ["restack", "a", "b"], ["stack", "plan"], ["stack", "list"], ["status", "--stash"], ["ack", "x", "--dry-run"]];
  for (const argv of wrong) {
    const result = await grove(argv);
    expect(result.code, argv.join(" ")).toBe(1);
    expect(result.err, argv.join(" ")).toContain("Usage: git grove");
  }
});
