import { ago } from "../ago.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { plural } from "../plural.js";
import type { RepoPins } from "../slice-requests.js";
import type { Load } from "../state.js";
import { empty } from "./empty.js";
import { loadView } from "./load-view.js";
import { viewBar } from "./view-bar.js";

function pinnedAt(at: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(at);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
}

/** Every pin grove holds, by repository, newest first: the branch, the pin's ref and commit, and its age. */
export function pinsView(pins: Load<RepoPins[]> | null, now: number): SafeHtml {
  const list = loadView(pins, "pins", (repos) => {
    const held = repos.filter((repo) => repo.pins.length > 0);
    if (held.length === 0) return empty("No pins");
    return html`${held.map(
      (repo) =>
        html`<div class="group static"><b>${repo.name}</b><span class="meta">${plural(repo.pins.length, "pin")}</span></div>${repo.pins.map((pin) => {
          const at = pinnedAt(pin.at);
          return html`<div class="row pinrow"><span class="tcell">${ICONS.ring(14)}</span><span class="br">${pin.branch}</span><span class="mono ref">${pin.ref}</span><span class="num">${pin.sha.slice(0, 7)}</span><span class="when">${at === null ? pin.at : ago(at, now)}</span></div>`;
        })}`,
    )}`;
  });
  return html`${viewBar(html`<b>Pins</b>`)}<div class="list">${list}</div>`;
}
