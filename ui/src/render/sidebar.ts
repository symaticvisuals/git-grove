import type { WireProject, WireRepoView } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { LiveState } from "../live.js";
import type { Route } from "../parse-route.js";
import { plural } from "../plural.js";
import type { Load } from "../state.js";
import { groupsOf } from "./groups-of.js";
import { loadView } from "./load-view.js";
import { timeAgo } from "./time-ago.js";

export type SidebarInput = { route: Route; projects: Load<WireProject[]>; repo: WireRepoView | null; live: LiveState; now: number };

function nav(href: string, on: boolean, icon: SafeHtml, label: string, count: SafeHtml | string = ""): SafeHtml {
  return html`<a class="nav${on ? " on" : ""}" href="${href}" data-key="nav:${href}"${on ? html` aria-current="page"` : ""}>${icon}${label}${count}</a>`;
}

function footer(projects: WireProject[], live: LiveState, now: number): SafeHtml {
  if (live !== "up") return html`<div class="side-foot"><div><span class="pulse off" aria-hidden="true"></span>Not connected, retrying</div></div>`;
  const newest = Math.max(...projects.map((project) => project.scannedAt ?? 0));
  const when = newest > 0 ? html`, ${timeAgo(newest, now, "long")}` : "";
  return html`<div class="side-foot"><div><span class="pulse" aria-hidden="true"></span><span>Watching ${plural(projects.length, "repo")}${when}</span></div></div>`;
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
 * and, under the current one, its groups to jump to; then whether the dashboard is live, and how fresh it is.
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
<a class="sec${route.view === "projects" ? " on" : ""}" href="#/" data-key="nav:#/">Repos<span>All</span></a>
<div class="repos">${repos}</div>
${footer(data, input.live, input.now)}`;
}
