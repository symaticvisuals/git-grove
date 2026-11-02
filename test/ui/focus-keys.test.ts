import { expect, test } from "vitest";
import { detailPanel } from "../../ui/src/render/detail-panel.js";
import { repoView } from "../../ui/src/render/repo-view.js";
import { sidebar } from "../../ui/src/render/sidebar.js";
import type { WireRepoView } from "../../src/server/wire/wire.types.js";
import type { RowRef } from "../../ui/src/parse-route.js";
import { feature, finding, level, project, repoView as view } from "./wire-fixtures.js";

const moved = finding("parent-moved", { severity: "needs-action" });

function stack(id: string, name: string): ReturnType<typeof feature> {
  return feature({
    id,
    name,
    levels: [
      level({ branch: `${name}/01`, depth: 1, number: "01", worktree: { path: `/w/${name}/01`, rel: `${name}/01`, dirty: 0, operation: null, touchedAt: 1 } }),
      level({ branch: `${name}/02`, depth: 2, number: "02", health: "action", findings: [moved], worktree: { path: `/w/${name}/02`, rel: `${name}/02`, dirty: 0, operation: null, touchedAt: 1 } }),
      level({ branch: `${name}/03`, depth: 3, number: "03", worktree: { path: `/w/${name}/03`, rel: `${name}/03`, dirty: 0, operation: null, touchedAt: 1 } }),
    ],
  });
}

const data: WireRepoView = view({ project: project({ id: 1 }), features: [stack("1.QQ", "one"), stack("1.Qg", "two")], cleanupCount: 1 });

function list(now: number, stale: boolean, pick: RowRef | null = null, closed: string[] = []): string {
  return repoView({ repoId: 1, repo: { status: "ready", data, stale }, activity: null, tab: "feature", needsOnly: false, closed, pick, now }).text;
}

function tabbable(text: string): string[] {
  return [...text.slice(text.indexOf('<div class="list">')).matchAll(/<[a-z]+\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /^<(button|a)\b/.test(tag) ? !tag.includes('tabindex="-1"') : tag.includes('tabindex="0"'))
    .map((tag) => /data-key="([^"]*)"/.exec(tag)?.[1] ?? "");
}

function keys(text: string): string[] {
  return [...text.matchAll(/data-key="([^"]*)"/g)].map((match) => match[1] ?? "");
}

function focusable(text: string): number {
  return (text.match(/<(?:button|a)\b[^>]*>|<[a-z]+\b[^>]*\btabindex="[^"]*"[^>]*>/g) ?? []).length;
}

function tagWithKey(text: string, key: string): string {
  const tags = [...text.matchAll(/<[a-z]+\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes(`data-key="${key}"`));
  expect(tags).toHaveLength(1);
  return tags[0] ?? "";
}

test("every focusable element in the list, sidebar and detail has a key, and no key repeats", () => {
  const regions = [
    list(1, false),
    sidebar({ route: { view: "repo", repo: 1, pick: null }, projects: { status: "ready", data: [data.project], stale: false }, repo: data, live: "up", now: 2 }).text,
    detailPanel({ repo: { status: "ready", data, stale: false }, pick: { kind: "feature", feature: "1.Qg", branch: "two/02" }, feature: null, preview: null, now: 2 }).text,
  ];
  for (const text of regions) {
    expect(keys(text)).toHaveLength(focusable(text));
    expect(new Set(keys(text)).size).toBe(keys(text).length);
  }
});

test("row 03's Open in editor and stack two's Restack keep one key each across a repaint after a digest", () => {
  const before = list(1, false);
  const after = list(90_000, true);
  const editor = keys(before).find((key) => key.endsWith("two%2F03:open-editor")) ?? "";
  expect(tagWithKey(before, editor)).toContain('data-path="/w/two/03"');
  expect(tagWithKey(after, editor)).toContain('data-path="/w/two/03"');
  const restack = "group:f:1.Qg:restack";
  expect(tagWithKey(after, restack)).toContain('data-feature="1.Qg"');
  expect(tagWithKey(after, "group:f:1.QQ:restack")).toContain('data-feature="1.QQ"');
});

test("a stack offers Restack only when one of its levels has a parent that moved or merged", () => {
  const calm = view({ features: [feature({ id: "1.Qw", name: "calm", levels: [level({ branch: "calm/01" })] })] });
  const text = repoView({ repoId: 1, repo: { status: "ready", data: calm, stale: false }, activity: null, tab: "feature", needsOnly: false, closed: [], pick: null, now: 1 }).text;
  expect(text).not.toContain('data-action="restack"');
  expect(text).toContain('data-action="add-level"');
  expect(list(1, false)).toContain('data-key="group:f:1.Qg:restack"');
});

test("the list is one Tab stop: the selected row and its own actions, else the first row", () => {
  const picked = tabbable(list(1, false, { kind: "feature", feature: "1.Qg", branch: "two/02" }));
  const row = "row:#/r/1/f/1.Qg/two%2F02";
  expect(picked).toEqual([row, `${row}:restack`, `${row}:open-editor`, `${row}:open-terminal`, `${row}:palette`]);
  expect(tabbable(list(1, false))[0]).toBe("row:#/r/1/f/1.QQ/one%2F01");
  const folded = tabbable(list(1, false, { kind: "feature", feature: "1.QQ", branch: "one/01" }, ["f:1.QQ"]));
  expect(folded).toEqual(["group:f:1.QQ"]);
  expect(tabbable(list(1, false, null, ["f:1.QQ"]))[0]).toBe("row:#/r/1/f/1.Qg/two%2F01");
  expect(tabbable(list(1, false, null, ["f:1.QQ", "f:1.Qg"]))).toEqual(["group:f:1.QQ"]);
});

test("when the selected row's group is folded, its header holds the list's Tab stop", () => {
  expect(tabbable(list(1, false, { kind: "feature", feature: "1.Qg", branch: "two/02" }, ["f:1.Qg"]))).toEqual(["group:f:1.Qg"]);
});
