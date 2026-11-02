import type { Lane } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** A lane of commits, newest on top; lost commits are dashed and a pinned one wears the resin ring. */
export function laneView(lane: Lane, ringed = false): SafeHtml {
  const commits = [...lane.commits].reverse().map((commit) => {
    const kinds = [commit.lost ? "lost" : "", commit.tip ? "tip" : "", commit.base ? "base" : ""].filter((kind) => kind !== "").join(" ");
    return html`<div class="cm${kinds === "" ? "" : ` ${kinds}`}"><span class="nd">${commit.pinned ? html`<i class="pinring"></i>` : ""}</span><span class="sha">${commit.sha.slice(0, 7)}</span><span class="msg">${commit.subject}</span></div>`;
  });
  return html`<div class="lane"><div class="cap">${ringed ? ICONS.ring(10) : ""}${lane.caption}</div><div class="commits">${commits}</div></div>`;
}
