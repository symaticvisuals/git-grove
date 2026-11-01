import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { run } from "../../src/cli/main.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let fork: string;

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
  await repo.git("config", "stack.trunk", "main");
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  fork = await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  await repo.commit("a.txt", "a\n", "add a");
  await repo.commit("b.txt", "b\n", "add b");
  await repo.commit("c.txt", "c\n", "add c");
});
afterEach(() => repo.cleanup());

async function grove(argv: string[], cwd: string = repo.path): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd });
  return { code, out: out.join(""), err: err.join("") };
}

async function squash(): Promise<void> {
  await repo.git("reset", "--soft", fork);
  await repo.git("commit", "-m", "squashed");
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, key: string): unknown {
  if (!isRecord(value) || !(key in value)) throw new Error(`missing ${key}`);
  return value[key];
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value;
}

async function statusJson(): Promise<Record<"findings" | "journal", unknown[]> & { keys: string[] }> {
  const result = await grove(["status", "--json"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  const doc: unknown = JSON.parse(result.out);
  return {
    keys: isRecord(doc) ? Object.keys(doc).sort() : [],
    findings: list(field(doc, "findings")),
    journal: list(field(doc, "journal")),
  };
}

function rulesOf(findings: unknown[]): unknown[] {
  return findings.map((finding) => field(finding, "rule"));
}

test("status --json after a squash is one JSON document with one history-rewritten finding", async () => {
  await grove(["status"]);
  await squash();

  const doc = await statusJson();
  expect(doc.keys).toEqual(["features", "findings", "journal", "repo", "trunk"]);
  const rewritten = doc.findings.filter((finding) => field(finding, "rule") === "history-rewritten");
  expect(rewritten).toHaveLength(1);
  expect(field(rewritten[0], "subject")).toEqual({ kind: "branch", id: "feat" });
  expect(doc.journal).toHaveLength(1);
});

test("status prints Needs you with the rewrite and how to undo it", async () => {
  await grove(["status"]);
  await squash();

  const result = await grove(["status"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Needs you");
  expect(result.out).toMatch(/history rewritten/i);
  expect(result.out).toContain("git grove restore feat");
  expect(result.out).toMatch(/^feat\s+clean\s+no remote\s+0\s/m);
});

test("restore brings the commits back and the next status has no rewrite", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);

  const result = await grove(["restore", "feat"]);
  expect(result).toMatchObject({ code: 0, err: "" });
  expect(result.out).toMatch(/^restored feat: [0-9a-f]{7} → [0-9a-f]{7} \(old tip pinned at refs\/grove\/pins\/feat\/\S+\)\n$/);
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("3");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
});

test("a rewrite whose commits later reach the trunk no longer alerts", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);
  await repo.switch("main");
  await repo.git("merge", "--squash", "feat");
  await repo.git("commit", "-m", "land feat");

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).not.toContain("history-rewritten");
  expect(doc.journal).toEqual([]);
});

test("a branch reset back onto the trunk keeps its rewrite alert", async () => {
  await grove(["status"]);
  await repo.git("reset", "--hard", fork);

  const doc = await statusJson();
  expect(rulesOf(doc.findings)).toContain("history-rewritten");
});

test("check remove refuses a merged worktree holding .local/seed.sql", async () => {
  await repo.switch("main");
  await repo.worktree(join(repo.path, ".worktrees", "old"), "old");
  await write(join(repo.path, ".worktrees", "old", ".local", "seed.sql"), "insert;\n");

  const result = await grove(["check", "remove", ".worktrees/old"]);
  expect(result).toMatchObject({ code: 3, err: "" });
  expect(result.out).toContain(".local/seed.sql");

  const json = await grove(["check", "remove", ".worktrees/old", "--json"]);
  expect(json.code).toBe(3);
  const verdict: unknown = JSON.parse(json.out);
  expect(verdict).toMatchObject({ ok: false, reasons: [{ code: "precious-ignored", paths: [".local/seed.sql"] }] });

  expect(rulesOf((await statusJson()).findings)).toContain("unsafe-merged-worktree");
});

test("status lists a merged worktree's files only under its removal alert, with paths from the root", async () => {
  await repo.switch("main");
  await repo.commit(".gitignore", ".worktrees/\n.local/\n.env\n", "ignore env");
  await write(join(repo.path, ".env"), "KEY=1\n");
  await repo.worktree(join(repo.path, ".worktrees", "old"), "old");
  await write(join(repo.path, ".worktrees", "old", ".local", "seed.sql"), "insert;\n");

  const { out } = await grove(["status"]);
  expect(out.match(/\.local\/seed\.sql/g)).toHaveLength(1);
  expect(out).toContain(".env exist in the main worktree but not in .worktrees/old\n");
  expect(out).toMatch(/^old\s+clean\s+merged\s+0\s/m);
});

test("check remove passes a clean merged worktree and refuses the main one", async () => {
  await repo.worktree(join(repo.path, ".worktrees", "tidy"), "tidy", "main");

  expect(await grove(["check", "remove", join(repo.path, ".worktrees", "tidy")])).toMatchObject({ code: 0, err: "" });
  expect(await grove(["check", "remove", "."])).toMatchObject({
    code: 3,
    out: "the main worktree is never removed\n",
  });
});

test("check remove on a folder that is not a worktree exits 1 with one line on stderr", async () => {
  const result = await grove(["check", "remove", "nowhere"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err.trimEnd().split("\n")).toHaveLength(1);
});

test("pins list prints each pin ref with its short sha", async () => {
  await grove(["status"]);
  await squash();
  await grove(["status"]);
  const pinRef = (await repo.git("for-each-ref", "--format=%(refname)", "refs/grove/pins/feat")).trim();
  const pinSha = (await repo.git("rev-parse", pinRef)).trim();

  const result = await grove(["pins", "list"]);
  expect(result).toMatchObject({ code: 0, out: `${pinRef}  ${pinSha.slice(0, 7)}\n` });
  expect((await grove(["pins", "list", "feat"])).out).toContain(pinRef);
  expect((await grove(["pins", "list", "other"])).out).toBe("");
});

test("status outside a repository exits 1 with exactly one line on stderr", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    const result = await grove(["status"], outside);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(/^git-grove: [^\n]+\n$/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("restore with no pin exits 1 with one line on stderr", async () => {
  const result = await grove(["restore", "feat"]);
  expect(result).toMatchObject({ code: 1, out: "", err: "git-grove: no pin found for feat\n" });
});

test("an unknown flag exits 1 with usage on stderr", async () => {
  const result = await grove(["status", "--nope"]);
  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  expect(result.err).toContain("Usage: git grove");
});

test("a command with the wrong arguments exits 1 with usage on stderr", async () => {
  for (const argv of [["restore"], ["pins"], ["check", "remove"], ["check", "push", "x"], ["restore", "feat", "--json"]]) {
    const result = await grove(argv);
    expect(result.code, argv.join(" ")).toBe(1);
    expect(result.err, argv.join(" ")).toContain("Usage: git grove");
  }
});

test("a missing git binary exits 1 with one line", async () => {
  const savedPath = process.env["PATH"];
  process.env["PATH"] = join(home, "no-bin");
  try {
    expect(await grove(["status"])).toEqual({ code: 1, out: "", err: "git-grove: git not found on PATH\n" });
  } finally {
    if (savedPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedPath;
  }
});
