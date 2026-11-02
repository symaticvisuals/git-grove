import type { Health } from "../../../src/server/wire/health-of.js";
import type { ActivityItem, WireRepoView } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { type RowRef, routeHash } from "../parse-route.js";
import { plural } from "../plural.js";
import type { Load, Tab } from "../state.js";
import { worstFinding } from "../worst-finding.js";
import { activityList } from "./activity-list.js";
import { banner } from "./banner.js";
import { empty } from "./empty.js";
import { groupsOf, type ListGroup, type ListRow } from "./groups-of.js";
import { healthGroupsOf } from "./health-groups-of.js";
import { listRow } from "./list-row.js";
import { loadView } from "./load-view.js";
import { rowHref } from "./row-href.js";
import { viewBar } from "./view-bar.js";

export type RepoViewInput = {
  repoId: number;
  repo: Load<WireRepoView> | null;
  activity: Load<ActivityItem[]> | null;
  tab: Tab;
  needsOnly: boolean;
  closed: readonly string[];
  pick: RowRef | null;
  now: number;
};

const TALLY_ORDER: Health[] = ["loses", "action", "review", "fine", "idle"];

const TABS: [Tab, string][] = [
  ["feature", "By feature"],
  ["health", "By health"],
  ["activity", "Activity"],
];

function needsYou(row: ListRow): boolean {
  return row.health === "loses" || row.health === "action";
}

function tally(rows: readonly ListRow[]): SafeHtml {
  return html`${TALLY_ORDER.map((health) => {
    const count = rows.filter((row) => row.health === health).length;
    return count === 0 ? "" : html`<span>${ICONS.health(health)}${count}</span>`;
  })}`;
}

function groupActions(group: ListGroup): SafeHtml {
  if (group.kind === "stack" && group.feature !== null) {
    const id = group.feature.id;
    const moved = group.feature.levels.some((level) => {
      const rule = worstFinding(level.findings)?.rule;
      return rule === "parent-moved" || rule === "parent-merged";
    });
    const restack = moved ? html`<button class="gbtn hot" data-action="restack" data-feature="${id}" data-key="group:${group.key}:restack" tabindex="-1">${ICONS.restack}Restack</button>` : "";
    return html`${restack}<button class="gbtn" data-action="add-level" data-feature="${id}" data-key="group:${group.key}:add-level" tabindex="-1">${ICONS.plus}Add level</button>`;
  }
  if (group.kind === "singles" || group.kind === "detached") return html`<button class="gbtn" data-action="cleanup" data-key="group:${group.key}:cleanup" tabindex="-1">${ICONS.broom}Clean up</button>`;
  return html``;
}

function groupView(group: ListGroup, input: RepoViewInput, stop: string | null): SafeHtml {
  const closed = input.closed.includes(group.key);
  const rows = group.rows.map((_, index) => listRow(group.rows, index, { repoId: input.repoId, pick: input.pick, now: input.now, stop }));
  const tabindex = stop === `group:${group.key}` ? "0" : "-1";
  return html`<div class="group${closed ? " closed" : ""}" role="button" tabindex="${tabindex}" aria-expanded="${closed ? "false" : "true"}" data-ui="toggle-group" data-group="${group.key}" data-key="group:${group.key}">${ICONS.caret}<b>${group.name}</b><span class="meta">${group.meta}</span><span class="gacts">${groupActions(group)}</span><span class="tally">${tally(group.rows)}</span></div>
<div class="rows${closed ? " closed" : ""}">${rows}</div>`;
}

function tabStop(groups: readonly ListGroup[], input: RepoViewInput): string | null {
  const selected = input.pick === null ? null : routeHash({ view: "repo", repo: input.repoId, pick: input.pick });
  const holder = selected === null ? undefined : groups.find((group) => group.rows.some((row) => rowHref(input.repoId, row).href === selected));
  if (selected !== null && holder !== undefined) return input.closed.includes(holder.key) ? `group:${holder.key}` : selected;
  const open = groups.filter((group) => !input.closed.includes(group.key));
  const first = open[0]?.rows[0];
  if (first !== undefined) return rowHref(input.repoId, first).href;
  return groups[0] === undefined ? null : `group:${groups[0].key}`;
}

function summary(view: WireRepoView): string {
  const stacks = view.features.filter((feature) => feature.kind === "stack").length;
  const singles = view.features.filter((feature) => feature.kind === "single").reduce((total, feature) => total + feature.levels.length, 0);
  return `${plural(view.project.worktrees, "worktree")}, ${plural(stacks, "stack")}, ${plural(singles, "single")}, ${view.detached.length} detached`;
}

function filters(view: WireRepoView, needsOnly: boolean): SafeHtml {
  const cleanup =
    view.cleanupCount > 0
      ? html`<button class="fchip on clean" data-action="cleanup" data-key="filter:cleanup">${ICONS.cleanChip}${plural(view.cleanupCount, "worktree")} safe to clean up</button>`
      : "";
  return html`<div class="filters"><button class="fchip${needsOnly ? " on" : ""}" data-ui="needs-only" data-key="filter:needs-only" aria-pressed="${needsOnly ? "true" : "false"}">${ICONS.needsChip}Needs you</button>${cleanup}<span class="sum">${summary(view)}</span></div>`;
}

function groupsView(view: WireRepoView, input: RepoViewInput): SafeHtml {
  const all = input.tab === "health" ? healthGroupsOf(view) : groupsOf(view);
  if (all.length === 0) return empty("Nothing here yet besides the main checkout. New features and worktrees show up as they appear.");
  const shown = input.needsOnly ? all.map((group) => ({ ...group, rows: group.rows.filter(needsYou) })).filter((group) => group.rows.length > 0) : all;
  if (shown.length === 0) return empty("Nothing needs you");
  const stop = tabStop(shown, input);
  return html`${shown.map((group) => groupView(group, input, stop))}`;
}

function scanFailed(view: WireRepoView): SafeHtml {
  const { error, name } = view.project;
  return error === null ? html`` : html`<div class="list-note">${banner("warn", `Couldn't scan ${name}`, `${error}. Showing what grove saw last.`)}</div>`;
}

/**
 * A repository's view: its bar with the By feature, By health and Activity tabs and Scan now, the filters (the
 * Needs you toggle, the clean-up chip and a summary), and the list of its groups, or its activity on that tab. A
 * repo whose last scan failed keeps its last data under a banner. The list is one Tab stop: the selected row (its
 * group's header while that group is folded), else the first row of an open group, else the first group's header.
 * Group buttons are reached by mouse, the palette or the shortcut keys.
 */
export function repoView(input: RepoViewInput): SafeHtml {
  const view = input.repo === null || input.repo.status === "loading" ? null : input.repo.data;
  const tabs = html`<div class="tabs" role="tablist">${TABS.map(([tab, label]) => html`<button class="tab${input.tab === tab ? " on" : ""}" role="tab" aria-selected="${input.tab === tab ? "true" : "false"}" data-ui="tab" data-tab="${tab}" data-key="tab:${tab}">${label}</button>`)}</div>`;
  const crumb = html`<span class="dim">${view?.project.name ?? "Repo"}</span><span class="sep">›</span><b>Worktrees</b>`;
  const body =
    input.tab === "activity"
      ? loadView(input.activity, "activity", (items) => activityList(items, input.now))
      : loadView(input.repo, "repo", (data) => html`${scanFailed(data)}${groupsView(data, input)}`);
  return html`${viewBar(crumb, { tabs, repo: input.repoId })}${view === null ? "" : filters(view, input.needsOnly)}<div class="list">${body}</div>`;
}
