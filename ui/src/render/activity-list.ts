import type { Health } from "../../../src/server/wire/health-of.js";
import type { ActivityItem } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { empty } from "./empty.js";
import { clockAt } from "./clock-at.js";

const HEALTH_OF: Record<ActivityItem["severity"], Health | null> = {
  "loses-work": "loses",
  "needs-action": "action",
  "waiting-on-review": "review",
  idle: "idle",
  info: null,
};

/** A timeline of activity, newest first, each with its branch and 24-hour time, and its repo's name when `repoNames` has it. */
export function activityList(items: readonly ActivityItem[], now: number, repoNames: ReadonlyMap<number, string> = new Map()): SafeHtml {
  if (items.length === 0) return empty("No activity yet");
  const rows = items.map((item) => {
    const health = HEALTH_OF[item.severity];
    const repo = repoNames.get(item.repoId);
    return html`<div class="ev"><span class="ev-ic">${health === null ? ICONS.dot : ICONS.health(health)}</span><div class="ev-body"><div class="ev-title">${item.title}${item.branch === null || item.title.includes(item.branch) ? "" : html` <code>${item.branch}</code>`}</div>${item.detail === "" ? "" : html`<div class="why">${item.detail}</div>`}<div class="t">${repo === undefined ? "" : html`${repo} · `}${clockAt(item.at, now)}</div></div></div>`;
  });
  return html`<div class="timeline">${rows}</div>`;
}
