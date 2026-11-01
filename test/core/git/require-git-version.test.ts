import { expect, test } from "vitest";
import { GitVersionError } from "../../../src/core/git/git-version.error.js";
import { parseGitVersion, requireGitVersion } from "../../../src/core/git/require-git-version.js";

test("parseGitVersion reads Apple and plain git", () => {
  expect(parseGitVersion("git version 2.55.0")).toEqual([2, 55, 0]);
  expect(parseGitVersion("git version 2.39.3 (Apple Git-146)")).toEqual([2, 39, 3]);
});

test("parseGitVersion rejects unrecognised output", () => {
  expect(() => parseGitVersion("hello")).toThrow(GitVersionError);
});

test("requireGitVersion passes for an old minimum", async () => {
  await expect(requireGitVersion([2, 0])).resolves.toBeUndefined();
});

test("requireGitVersion fails with the exact message for a far-future minimum", async () => {
  await expect(requireGitVersion([99, 0])).rejects.toThrow(/^git-grove needs git 99\.0 or newer \(found \d+\.\d+\)$/);
});
