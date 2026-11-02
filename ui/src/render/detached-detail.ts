import type { WireRepoView } from "../../../src/server/wire/wire.types.js";
import { HEALTH_LABEL } from "../health-label.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { plural } from "../plural.js";
import { detailHead } from "./detail-head.js";
import { optionCard } from "./option-card.js";
import { timeAgo } from "./time-ago.js";

/** The detail of the detached sandboxes: each folder with its health and age, and Clean up when any is safe to remove. */
export function detachedDetail(view: WireRepoView, now: number): SafeHtml {
  const rows = view.detached.map(
    (sandbox) =>
      html`<div class="sbox">${ICONS.health(sandbox.health)}<span class="mono">${sandbox.rel}</span><span class="why">${sandbox.state}${sandbox.touchedAt === null ? "" : html`, ${timeAgo(sandbox.touchedAt, now, "long")}`}</span><span class="sr">${HEALTH_LABEL[sandbox.health]}</span></div>`,
  );
  const cleanup =
    view.cleanupCount > 0
      ? html`<div class="opts">${optionCard("Clean up worktrees", "Only folders whose work is safe somewhere else. Grove re-checks each one right before removing it.", html`<button class="btn primary" data-action="cleanup" data-key="detail:cleanup">Clean up</button>`)}</div>`
      : "";
  return html`${detailHead(["Detached"], `${plural(view.detached.length, "sandbox", "sandboxes")}, detached`)}<div class="d-sec"><div class="sboxes">${rows}</div>${cleanup}</div>`;
}
