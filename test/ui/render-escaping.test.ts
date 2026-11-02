import { expect, test } from "vitest";
import { activityList } from "../../ui/src/render/activity-list.js";
import { detailPanel } from "../../ui/src/render/detail-panel.js";
import { needsYouView } from "../../ui/src/render/needs-you-view.js";
import { repoView } from "../../ui/src/render/repo-view.js";
import { activityItem, feature, featureDetail, finding, level, project, repoView as view } from "./wire-fixtures.js";

const EVIL = "<img src=x onerror=alert(1)>";
const SHOWN = "&lt;img src=x onerror=alert(1)&gt;";

function safe(text: string): void {
  expect(text).not.toContain("<img");
  expect(text).toContain(SHOWN);
}

const evilLevel = level({
  branch: `feat/${EVIL}`,
  parent: EVIL,
  health: "loses",
  state: EVIL,
  findings: [finding("history-rewritten", { severity: "loses-work", title: EVIL, detail: EVIL })],
  pinnedLost: 1,
  worktree: { path: `/w/${EVIL}`, rel: EVIL, dirty: 0, operation: null, touchedAt: null },
});
const evilFeature = feature({ name: EVIL, levels: [evilLevel] });
const evilView = view({ project: project({ name: EVIL, error: EVIL }), features: [evilFeature], orphans: [{ branch: EVIL, lost: ["abc"], pinRef: EVIL, lastTip: "def", at: 1 }] });

test("branch names, states, feature and repo names, and scan errors render as text in the list", () => {
  safe(repoView({ repoId: 1, repo: { status: "ready", data: evilView, stale: false }, activity: null, tab: "feature", needsOnly: false, closed: [], pick: null, now: 2 }).text);
});

test("commit subjects, pin refs and paths render as text in the detail", () => {
  const rewrite = {
    branch: evilLevel.branch,
    pinRef: EVIL,
    at: 1,
    lost: 1,
    matchedByPatch: 0,
    matchedByMeta: 0,
    before: { caption: "Before", commits: [{ sha: "abcdef1", subject: EVIL, tip: true, base: false, lost: true, pinned: true }] },
    now: { caption: "Now", commits: [{ sha: "1234567", subject: EVIL, tip: true, base: false, lost: false, pinned: false }] },
  };
  const out = detailPanel({
    repo: { status: "ready", data: evilView, stale: false },
    pick: { kind: "feature", feature: evilFeature.id, branch: evilLevel.branch },
    feature: { status: "ready", data: featureDetail({ feature: evilFeature, rewrites: [rewrite], activity: [activityItem({ title: EVIL, detail: EVIL, branch: EVIL })] }), stale: false },
    preview: null,
    now: 2,
  }).text;
  safe(out);
  safe(detailPanel({ repo: { status: "ready", data: evilView, stale: false }, pick: { kind: "deleted", branch: EVIL }, feature: null, preview: null, now: 2 }).text);
});

test("activity and needs-you entries render as text", () => {
  safe(activityList([activityItem({ title: EVIL, detail: EVIL, branch: "x" })], 2, new Map([[1, EVIL]])).text);
  const item = { repoId: 1, repoName: EVIL, featureId: null, orphan: null, finding: finding("idle", { title: EVIL, detail: EVIL, subject: { kind: "worktree", id: EVIL } }) };
  safe(needsYouView({ status: "ready", data: [item], stale: false }).text);
});
