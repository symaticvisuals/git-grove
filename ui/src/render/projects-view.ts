import type { ActivityItem, WireProject } from "../../../src/server/wire/wire.types.js";
import { HEALTH_LABEL } from "../health-label.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { plural } from "../plural.js";
import type { Load } from "../state.js";
import { activityList } from "./activity-list.js";
import { empty } from "./empty.js";
import { loadView } from "./load-view.js";
import { timeAgo } from "./time-ago.js";
import { viewBar } from "./view-bar.js";

function projectRow(project: WireProject, now: number): SafeHtml {
  const state = project.error !== null ? `Scan failed: ${project.error}` : project.needsYou > 0 ? `${plural(project.needsYou, "thing")} need${project.needsYou === 1 ? "s" : ""} you` : HEALTH_LABEL[project.health];
  const pins = project.pins > 0 ? html`<span class="pill pin">${ICONS.ring(10)}${plural(project.pins, "pin")}</span>` : "";
  return html`<div class="row prow h-${project.error === null ? project.health : "action"}" role="button" tabindex="0" data-href="#/r/${project.id}"><span class="tcell">${ICONS.health(project.health)}</span><span class="br">${project.name}<span class="root">${project.root}</span></span><span class="state">${state}</span><span class="pills"><span class="pill">${plural(project.worktrees, "worktree")}</span>${pins}</span><span class="when">${project.scannedAt === null ? "" : timeAgo(project.scannedAt, now)}</span></div>`;
}

/** Every watched repository, one row each, then the latest activity across them. */
export function projectsView(projects: Load<WireProject[]>, activity: Load<ActivityItem[]> | null, now: number): SafeHtml {
  const names = new Map((projects.status === "loading" ? [] : (projects.data ?? [])).map((project) => [project.id, project.name]));
  const list = loadView(projects, "projects", (data) =>
    data.length === 0 ? empty("No repos yet. Run git grove ui inside a repository.") : html`${data.map((project) => projectRow(project, now))}`,
  );
  const recent = loadView(activity, "activity", (items) => activityList(items, now, names));
  return html`${viewBar(html`<b>Projects</b>`)}<div class="list"><div class="group static"><b>Repos</b></div>${list}<div class="group static"><b>Latest activity</b><span class="meta">across repos</span></div><div class="strip">${recent}</div></div>`;
}
