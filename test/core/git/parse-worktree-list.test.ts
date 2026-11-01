import { expect, test } from "vitest";
import { parseWorktreeList } from "../../../src/core/git/parse-worktree-list.js";

const sample = [
  "worktree /repos/app",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree /repos/app-detached",
  "HEAD 2222222222222222222222222222222222222222",
  "detached",
  "",
  "worktree /repos/app-locked",
  "HEAD 3333333333333333333333333333333333333333",
  "branch refs/heads/feat/coupons-ui",
  "locked waiting on a usb drive",
  "",
  "worktree /repos/app-gone",
  "HEAD 4444444444444444444444444444444444444444",
  "branch refs/heads/feat/old-banner",
  "prunable gitdir file points to non-existent location",
  "",
].join("\n");

test("parses main, detached, locked and prunable worktrees", () => {
  expect(parseWorktreeList(sample)).toEqual([
    { path: "/repos/app", head: "1".repeat(40), branch: "main", bare: false, detached: false, locked: false, prunable: false },
    { path: "/repos/app-detached", head: "2".repeat(40), branch: null, bare: false, detached: true, locked: false, prunable: false },
    { path: "/repos/app-locked", head: "3".repeat(40), branch: "feat/coupons-ui", bare: false, detached: false, locked: true, prunable: false },
    { path: "/repos/app-gone", head: "4".repeat(40), branch: "feat/old-banner", bare: false, detached: false, locked: false, prunable: true },
  ]);
});

test("parses a bare entry and bare flags without reasons", () => {
  const [bare, locked] = parseWorktreeList(["worktree /repos/app.git", "bare", "", "worktree /x", "HEAD abc", "detached", "locked", ""].join("\n"));
  expect(bare).toEqual({ path: "/repos/app.git", head: null, branch: null, bare: true, detached: false, locked: false, prunable: false });
  expect(locked?.locked).toBe(true);
});

test("returns an empty list for empty output", () => {
  expect(parseWorktreeList("")).toEqual([]);
});
