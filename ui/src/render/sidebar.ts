import type { GuardState } from "../../../src/core/guard-install/guard-install.types.js";
import type { WireProject, WireRepoView } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { LiveState } from "../live.js";
import type { NotifyPermission } from "../notify.js";
import type { Route } from "../parse-route.js";
import { plural } from "../plural.js";
import type { Load } from "../state.js";
import { groupsOf } from "./groups-of.js";
import { guardStatus } from "./guard-status.js";
import { loadView } from "./load-view.js";
import { timeAgo } from "./time-ago.js";

export type SidebarInput = {
  route: Route;
  projects: Load<WireProject[]>;
  repo: WireRepoView | null;
  live: LiveState;
  now: number;
  /** Whether notifications may be raised; "Notify me" shows while the browser has not been asked. */
  notify?: NotifyPermission;
  /** Where the agent guard stands, shown as a quiet button that opens its dialog. */
  guard?: Load<GuardState> | null;
};

function nav(href: string, on: boolean, icon: SafeHtml, label: string, count: SafeHtml | string = ""): SafeHtml {
  return html`<a class="nav${on ? " on" : ""}" href="${href}" data-key="nav:${href}"${on ? html` aria-current="page"` : ""}>${icon}${label}${count}</a>`;
}

function notifyButton(permission: NotifyPermission | undefined): SafeHtml {
  if (permission !== "default") return html``;
  return html`<button class="notify" data-ui="notify" data-key="side:notify" title="A system notification when work is about to be lost">${ICONS.bell}Notify me</button>`;
}

function footer(projects: WireProject[], input: SidebarInput): SafeHtml {
  const { live, now } = input;
  const button = html`${notifyButton(input.notify)}${guardStatus(input.guard ?? null)}`;
  if (live !== "up") return html`<div class="side-foot">${button}<div><span class="pulse off" aria-hidden="true"></span>Not connected, retrying</div></div>`;
  const newest = Math.max(...projects.map((project) => project.scannedAt ?? 0));
  const when = newest > 0 ? html`, ${timeAgo(newest, now, "long")}` : "";
  return html`<div class="side-foot">${button}<div><span class="pulse" aria-hidden="true"></span><span>Watching ${plural(projects.length, "repo")}${when}</span></div></div>`;
}

function repoNav(project: WireProject, input: SidebarInput): SafeHtml {
  const current = input.route.view === "repo" && input.route.repo === project.id;
  const link = nav(`#/r/${project.id}`, current, ICONS.repoDot(project.health), project.name, html`<span class="count">${project.worktrees}</span>`);
  if (!current || input.repo === null || input.repo.project.id !== project.id) return link;
  const jumps = groupsOf(input.repo).map((group) => html`<button class="nav" data-ui="jump" data-group="${group.key}" data-key="jump:${group.key}">${group.name}</button>`);
  return html`${link}<div class="repo-sub">${jumps}</div>`;
}

/**
 * The sidebar: Needs you (hot when anything does), Activity, Pins, every repo with its health and worktree count
 * and, under the current one, its groups to jump to; then "Notify me" while notifications are not yet allowed or
 * refused, whether the agent guard is on, whether the dashboard is live, and how fresh it is.
 */
export function sidebar(input: SidebarInput): SafeHtml {
  const { route } = input;
  const data = input.projects.status === "loading" ? [] : (input.projects.data ?? []);
  const needs = data.reduce((total, project) => total + project.needsYou, 0);
  const pins = data.reduce((total, project) => total + project.pins, 0);
  const repos = loadView(input.projects, "projects", (projects) => html`${projects.map((project) => repoNav(project, input))}`);
  return html`<div class="ws">${ICONS.logo}<b>git grove</b><span class="local">local</span></div>
<button class="search" data-action="palette" data-key="side:palette">${ICONS.search}<span>Do or find anything</span><kbd>⌘K</kbd></button>
<button class="newbtn" data-action="new" data-key="side:new">${ICONS.plus}New feature<kbd>N</kbd></button>
${nav("#/needs", route.view === "needs", ICONS.needs, "Needs you", html`<span class="count${needs > 0 ? " hot" : ""}">${needs}</span>`)}
${nav("#/activity", route.view === "activity", ICONS.activity, "Activity")}
${nav("#/pins", route.view === "pins", ICONS.pin, "Pins", html`<span class="count">${pins}</span>`)}
${nav("#/setup", route.view === "setup", ICONS.compass, "Getting started")}
<a class="sec${route.view === "projects" ? " on" : ""}" href="#/" data-key="nav:#/">Repos<span>All</span></a>
<div class="repos">${repos}</div>
${footer(data, input)}`;
}
