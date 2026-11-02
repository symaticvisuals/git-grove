import type { WireFeature, WireLevel } from "../../../src/server/wire/wire.types.js";
import { ago } from "../ago.js";
import { HEALTH_LABEL } from "../health-label.js";
import { html, type HtmlValue, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { plural } from "../plural.js";
import { propsList } from "./props-list.js";

function upstreamText(level: WireLevel): string {
  const { upstream } = level;
  if (upstream === null) return "No remote";
  if (upstream.gone) return "Gone from the remote";
  const parts = [upstream.ahead > 0 ? `${upstream.ahead} to push` : "", upstream.behind > 0 ? `${upstream.behind} to pull` : ""].filter((part) => part !== "");
  return parts.length === 0 ? "Pushed" : parts.join(", ");
}

/** A level's properties: its folder, parent, uncommitted changes, upstream, health and when it was last touched. */
export function levelProps(feature: WireFeature, level: WireLevel, now: number): SafeHtml {
  const { worktree } = level;
  const rows: [string, HtmlValue][] = [["Worktree", worktree === null ? "No worktree" : html`<span class="mono">${worktree.rel}</span>`]];
  if (feature.kind === "stack") rows.push(["Parent", html`<span class="mono">${level.parent}</span>`]);
  if (worktree !== null) rows.push(["Changes", worktree.dirty === 0 ? "Clean" : plural(worktree.dirty, "file")]);
  if (worktree?.operation) rows.push(["In progress", `A ${worktree.operation} is not finished`]);
  rows.push(["Upstream", upstreamText(level)]);
  rows.push(["Status", html`${ICONS.health(level.health)} ${HEALTH_LABEL[level.health]}`]);
  if (worktree?.touchedAt != null) rows.push(["Touched", ago(worktree.touchedAt, now, "long")]);
  return propsList(rows);
}
