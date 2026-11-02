import type { WireFeatureDetail, WireLevel, WireRewrite } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { plural } from "../plural.js";
import type { Load } from "../state.js";
import { banner } from "./banner.js";
import { checkRow } from "./check-row.js";
import { laneView } from "./lane-view.js";
import { loadView } from "./load-view.js";
import { optionCard } from "./option-card.js";
import { safeBox } from "./safe-box.js";

function latest(detail: WireFeatureDetail, branch: string): WireRewrite | null {
  return detail.rewrites.filter((rewrite) => rewrite.branch === branch).reduce<WireRewrite | null>((last, rewrite) => (last === null || rewrite.at > last.at ? rewrite : last), null);
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * What a rewritten level's detail shows: the banner, the "Nothing is lost yet" box when the old commits are pinned,
 * Bring back and Keep, the before and now lanes, and the two checks that tell a loss from a rebase.
 */
export function rewriteSections(level: WireLevel, detail: Load<WireFeatureDetail> | null): SafeHtml {
  const data = detail === null || detail.status === "loading" ? null : detail.data;
  const rewrite = data === null ? null : latest(data, level.branch);
  const lost = rewrite?.lost ?? level.pinnedLost;
  const left = rewrite?.now?.commits.filter((commit) => !commit.base).length ?? null;
  const word = left === 1 && lost > 1 ? "squash" : "rewrite";
  const them = lost === 1 ? "it" : `all ${lost}`;
  const happened = rewrite === null ? "The branch was rewritten." : `At ${clock(rewrite.at)} the branch was rewritten${left === null ? "" : `, leaving ${left === 1 ? "one commit" : plural(left, "commit")}`}.`;
  const pinRef = rewrite?.pinRef ?? null;
  const pinned = rewrite === null ? level.pinnedLost > 0 : pinRef !== null;
  const commits = lost === 1 ? "The commit" : `The ${lost} commits`;
  const top = html`<div class="d-sec">
${banner("loses", `${plural(lost, "commit")} ${lost === 1 ? "is" : "are"} no longer on this branch`, `${happened} The history the reviewers saw is gone from the branch.`)}
${!pinned ? "" : safeBox("Nothing is lost yet", `Grove pinned ${them} before deciding anything. They stay until you remove the pin.`, pinRef)}
<div class="opts">
${optionCard(`Bring ${commits.toLowerCase()} back`, `The ${word} is kept too, so you can undo.`, html`<button class="btn primary" data-action="restore" data-branch="${level.branch}"${pinRef === null ? "" : html` data-pin="${pinRef}"`}>Bring back <kbd>R</kbd></button>`)}
${optionCard(`Keep the ${word}`, "Clears the alert. The old commits stay pinned.", html`<button class="btn" data-action="ack" data-branch="${level.branch}">Keep <kbd>A</kbd></button>`)}
</div></div>`;
  const lanes = loadView(detail, "feature", () =>
    rewrite === null ? html`` : html`<div class="compare">${laneView({ ...rewrite.before, caption: "Before, pinned" }, true)}${rewrite.now === null ? "" : laneView(rewrite.now)}</div>`,
  );
  const checks =
    rewrite === null
      ? html``
      : html`<div class="d-sec"><div class="h3">Why grove calls it a loss, not a rebase</div><div class="checks">
${checkRow({ ok: rewrite.matchedByPatch === rewrite.lost, text: `${rewrite.matchedByPatch} of ${plural(rewrite.lost, "old commit")} found by their change`, why: `A rebase keeps each change, so it would match all ${rewrite.lost}.` })}
${checkRow({ ok: rewrite.matchedByMeta === rewrite.lost, text: `${rewrite.matchedByMeta} of ${rewrite.lost} found by author, time and message`, why: "This catches a rebase that resolved a conflict." })}
</div></div>`;
  return html`${top}<div class="d-sec"><div class="h3">What happened</div>${lanes}</div>${checks}`;
}
