import type { WireOrphan } from "../../../src/server/wire/wire.types.js";
import { ago } from "../ago.js";
import { html, type SafeHtml } from "../html.js";
import { plural } from "../plural.js";
import { banner } from "./banner.js";
import { detailHead } from "./detail-head.js";
import { optionCard } from "./option-card.js";
import { safeBox } from "./safe-box.js";

/** The detail of a deleted branch whose commits are still unresolved: what was lost, where it is kept, Bring back and Keep. */
export function deletedDetail(orphan: WireOrphan, now: number): SafeHtml {
  const count = orphan.lost.length;
  const pinned = orphan.pinRef !== null;
  const lost = html`<div class="lost">${orphan.lost.map((sha) => html`<div><span>${sha.slice(0, 7)}</span><span>only on ${orphan.branch}</span></div>`)}</div>`;
  const restore = html`<button class="btn primary" data-action="restore" data-branch="${orphan.branch}"${pinned ? html` data-pin="${orphan.pinRef ?? ""}"` : ""}>Bring back <kbd>R</kbd></button>`;
  const keep = html`<button class="btn" data-action="ack" data-branch="${orphan.branch}">Keep <kbd>A</kbd></button>`;
  return html`${detailHead(["Deleted branches"], orphan.branch)}<div class="d-sec">
${banner("loses", `${plural(count, "commit")} ${count === 1 ? "was" : "were"} only on this branch`, `The branch was deleted ${ago(orphan.at, now, "long")}.${pinned ? "" : " Grove could not pin its commits."}`)}
${pinned ? safeBox("Nothing is lost yet", "Grove pinned them before deciding anything. They stay until you remove the pin.", orphan.pinRef) : ""}
<div class="opts">${optionCard("Bring the branch back", `It comes back at ${orphan.lastTip.slice(0, 7)}, where it was.`, restore)}${optionCard("Keep it deleted", "Clears the alert. The commits stay pinned.", keep)}</div>
</div><div class="d-sec"><div class="h3">Commits only on it</div>${lost}</div>`;
}
