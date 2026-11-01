import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { run } from "../../src/cli/main.js";
import { squashedFixture } from "../support/squashed-fixture.js";

const GOLDEN = new URL("./golden/status.golden.txt", import.meta.url);
const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-golden-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

test("status and status --json print the same text as the committed golden file", async () => {
  const fixture = await squashedFixture();
  try {
    const grove = async (argv: string[]): Promise<string> => {
      const out: string[] = [];
      await run(argv, { out: (s) => out.push(s), err: () => undefined, cwd: fixture.repo.path });
      return out.join("");
    };
    let all = (await grove(["status"])) + (await grove(["status", "--json"]));
    await fixture.squash();
    all += (await grove(["status"])) + (await grove(["status", "--json"]));
    const real = await realpath(fixture.repo.path);
    const normalised = all
      .split(real)
      .join("REPO")
      .split(fixture.repo.path)
      .join("REPO")
      .replace(/git-grove-repo-[A-Za-z0-9]+/g, "REPO")
      .replace(/scanned in [0-9.]+ s/g, "scanned in N s")
      .replace(/"(touchedAt|at)": \d+/g, '"$1": T')
      .replace(/\b[0-9a-f]{40}\b/g, "SHA")
      .replace(/\d{8}T\d{6}Z(-\d+)?/g, "STAMP");
    if (process.env["UPDATE_GOLDEN"] === "1") await writeFile(GOLDEN, normalised);
    expect(normalised).toBe(await readFile(GOLDEN, "utf8"));
  } finally {
    await fixture.repo.cleanup();
  }
}, 60_000);
