import { expect, test } from "vitest";
import { levelDetail } from "../../ui/src/render/level-detail.js";
import { feature, finding, level, repoView } from "./wire-fixtures.js";

function htmlFor(row: ReturnType<typeof level>): string {
  const feat = feature({ levels: [row] });
  return levelDetail({ view: repoView({ features: [feat] }), feature: feat, level: row, detail: null, preview: null, now: 1_000 }).text;
}

test("a gone worktree offers Forget, still offers restack when the parent merged, and hides Open in editor", () => {
  const gone = level({
    health: "action",
    state: "Worktree folder is gone",
    findings: [finding("prunable", { title: "Worktree folder is gone" }), finding("parent-merged", { title: "Parent merged" })],
  });
  const html = htmlFor(gone);
  expect(html).toContain('data-action="forget"');
  expect(html).toContain(">Forget <kbd>R</kbd>");
  expect(html).toContain('data-action="restack"');
  expect(html).not.toContain("open-editor");
  expect(html).not.toContain("Force forget");
});

test("a gone detached worktree that would lose commits offers Force forget", () => {
  const gone = level({
    health: "loses",
    findings: [finding("prunable", { severity: "loses-work", title: "Worktree folder is gone" })],
  });
  const html = htmlFor(gone);
  expect(html).toContain("Force forget");
  expect(html).toContain('data-action="forget"');
  expect(html).not.toContain("open-editor");
});
