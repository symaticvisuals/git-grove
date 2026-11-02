import { expect, test } from "vitest";
import { needsYouView } from "../../ui/src/render/needs-you-view.js";
import { sentence } from "../../ui/src/sentence.js";
import { finding } from "./wire-fixtures.js";

test("sentence capitalises prose but leaves a branch, path or named word it starts with alone", () => {
  expect(sentence("no change in 30 days")).toBe("No change in 30 days.");
  expect(sentence("feat/coupons-ui has 1 commit not in feat/coupons-email")).toBe("feat/coupons-ui has 1 commit not in feat/coupons-email.");
  expect(sentence(".env exists in the main worktree but not in /w/a")).toBe(".env exists in the main worktree but not in /w/a.");
  expect(sentence("main has 2 commits not in feat/x", ["main"])).toBe("main has 2 commits not in feat/x.");
  expect(sentence("main has 2 commits not in feat/x")).toBe("Main has 2 commits not in feat/x.");
  expect(sentence("Done already.")).toBe("Done already.");
});

test("the Needs you list keeps branch names as they are, including a level's parent", () => {
  const item = (rule: string, kind: "branch" | "level" | "worktree", id: string, detail: string) => ({
    repoId: 1,
    repoName: "acme-shop",
    featureId: null,
    orphan: null,
    finding: finding(rule, { subject: { kind, id }, detail }),
  });
  const text = needsYouView({
    status: "ready",
    stale: false,
    data: [
      item("parent-moved", "level", "coupons/feat/coupons-ui", "feat/coupons-model has 1 commit not in feat/coupons-ui"),
      item("parent-moved", "level", "coupons/feat", "main has 2 commits not in feat"),
      item("idle", "worktree", "/w/a", "no change in 30 days"),
    ],
  }).text;
  expect(text).toContain(">feat/coupons-model has 1 commit not in feat/coupons-ui.<");
  expect(text).toContain(">main has 2 commits not in feat.<");
  expect(text).toContain(">No change in 30 days.<");
  expect(text).not.toContain("Feat/");
});
