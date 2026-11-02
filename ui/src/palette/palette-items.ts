import type { ActionName } from "../../../src/core/actions/plan.types.js";
import type { WireFeature, WireLevel, WireRepoView } from "../../../src/server/wire/wire.types.js";
import { type ActionData, dialogContext } from "../dialogs/dialog-context.js";
import type { DialogContext } from "../dialogs/dialog-specs.js";
import type { Route } from "../parse-route.js";
import { plural } from "../plural.js";
import type { State } from "../state.js";
import { worstFinding } from "../worst-finding.js";

export type PaletteRun = { open: ActionName; ctx: DialogContext } | { route: Route } | { scan: number };

export type PaletteItem = { kind: "Actions" | "Go to"; text: string; hint: string | null; run: PaletteRun };

function shownRepo(state: State): WireRepoView | null {
  const { route, repo } = state;
  if (route.view !== "repo" || repo === null || repo.status === "loading" || repo.data === null) return null;
  return repo.data.project.id === route.repo ? repo.data : null;
}

function action(repo: WireRepoView, text: string, hint: string | null, open: ActionName, data: ActionData = {}): PaletteItem {
  return { kind: "Actions", text, hint, run: { open, ctx: dialogContext(repo, data) } };
}

function levelActions(repo: WireRepoView, feature: WireFeature, level: WireLevel): PaletteItem[] {
  const data = { feature: feature.id, branch: level.branch };
  const path = level.worktree?.path;
  switch (worstFinding(level.findings)?.rule) {
    case "history-rewritten":
      return [
        action(repo, `Bring back ${plural(level.pinnedLost, "commit")} on ${level.branch}`, "R", "restore", data),
        action(repo, `Keep the squash on ${level.branch}`, "A", "ack", data),
      ];
    case "unsafe-merged-worktree":
      return path === undefined ? [] : [action(repo, level.precious > 0 ? `Copy the files, then remove ${level.branch}` : `Clean up ${level.branch}`, "R", "remove", { ...data, path })];
    case "env-missing":
      return path === undefined ? [] : [action(repo, `Copy env files into ${level.branch}`, null, "copy-env", { ...data, path })];
    default:
      return [];
  }
}

function needsRestack(feature: WireFeature): boolean {
  return feature.levels.some((level) => {
    const rule = worstFinding(level.findings)?.rule;
    return rule === "parent-moved" || rule === "parent-merged";
  });
}

function actions(repo: WireRepoView): PaletteItem[] {
  const items = [action(repo, "Start a new feature", "N", "new")];
  for (const feature of repo.features) for (const level of feature.levels) items.push(...levelActions(repo, feature, level));
  for (const orphan of repo.orphans) {
    const data = orphan.pinRef === null ? { branch: orphan.branch } : { branch: orphan.branch, pin: orphan.pinRef };
    items.push(action(repo, `Bring back ${orphan.branch}`, null, "restore", data), action(repo, `Keep ${orphan.branch} deleted`, null, "ack", { branch: orphan.branch }));
  }
  for (const feature of repo.features.filter((candidate) => candidate.kind === "stack")) {
    if (needsRestack(feature)) items.push(action(repo, `Restack ${feature.name}`, "S", "restack", { feature: feature.id }));
    items.push(action(repo, `Add a level to ${feature.name}`, null, "add-level", { feature: feature.id }));
  }
  if (repo.cleanupCount > 0) items.push(action(repo, "Clean up worktrees", `${repo.cleanupCount} safe`, "cleanup"));
  items.push({ kind: "Actions", text: "Scan now", hint: null, run: { scan: repo.project.id } });
  return items;
}

function goTo(text: string, hint: string | null, route: Route): PaletteItem {
  return { kind: "Go to", text, hint, run: { route } };
}

function rows(repo: WireRepoView): PaletteItem[] {
  const id = repo.project.id;
  const items = repo.features.flatMap((feature) =>
    feature.levels.map((level) => goTo(level.branch, feature.kind === "stack" ? feature.name : "Singles", { view: "repo", repo: id, pick: { kind: "feature", feature: feature.id, branch: level.branch } })),
  );
  for (const orphan of repo.orphans) items.push(goTo(orphan.branch, "Deleted branches", { view: "repo", repo: id, pick: { kind: "deleted", branch: orphan.branch } }));
  if (repo.detached.length > 0) items.push(goTo(plural(repo.detached.length, "detached sandbox", "detached sandboxes"), "Detached", { view: "repo", repo: id, pick: { kind: "detached" } }));
  return items;
}

function places(state: State, repo: WireRepoView | null): PaletteItem[] {
  const projects = state.projects.status === "loading" ? [] : (state.projects.data ?? []);
  const views = [goTo("Needs you", null, { view: "needs" }), goTo("Activity", null, { view: "activity" }), goTo("Pins", null, { view: "pins" })];
  const repos = projects.filter((project) => project.id !== repo?.project.id).map((project) => goTo(project.name, "Repo", { view: "repo", repo: project.id, pick: null }));
  return [...views, ...repos];
}

/**
 * What the palette offers for `query`: on a repo, its actions (new feature, each fix a level or deleted branch
 * needs, restack where a stack needs it, add a level, clean up, scan), then every row to go to; everywhere, the
 * views and the other repos. `query` matches anywhere in an item's text, ignoring case; Actions come before Go to.
 */
export function paletteItems(state: State, query: string): PaletteItem[] {
  const repo = shownRepo(state);
  const all = [...(repo === null ? [] : actions(repo)), ...(repo === null ? [] : rows(repo)), ...places(state, repo)];
  const wanted = query.trim().toLowerCase();
  return wanted === "" ? all : all.filter((item) => item.text.toLowerCase().includes(wanted));
}
