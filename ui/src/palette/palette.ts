import { paletteOptions } from "../render/palette-options.js";
import { paletteChoice } from "./palette-choice.js";
import type { State, UiAction } from "../state.js";
import { type PaletteItem, paletteItems } from "./palette-items.js";

export type PaletteDeps = { root: HTMLElement; dispatch(action: UiAction): void; run(item: PaletteItem): void };

/** `chosen` is the item painted as selected; `count` is how many were painted. */
export type PaletteHost = { paint(state: State): void; reset(): void; chosen(): PaletteItem | null; count(): number };

const SHELL =
  '<div class="palette" role="dialog" aria-modal="true" aria-label="Command menu"><input id="pal-q" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-label="Do something, or jump to a branch" placeholder="Do something, or jump to a branch" autocomplete="off" spellcheck="false"><ul id="pal-list" role="listbox" aria-label="Results"></ul></div>';

/**
 * Shows the ⌘K palette in `root`: a query box, written once per opening so typing is never interrupted, over the
 * matching items grouped as Actions then Go to, with the selected one marked for assistive tech and kept in view.
 * Typing filters; clicking an item runs it. What runs is always an item that was painted, the selection held within
 * a list that shrank.
 */
export function createPalette(deps: PaletteDeps): PaletteHost {
  const { root, dispatch } = deps;
  let mounted = false;
  let painted: PaletteItem[] = [];
  let index = 0;

  root.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.id === "pal-q") dispatch({ type: "palette-query", query: event.target.value });
  });
  root.addEventListener("click", (event) => {
    const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pal]") : null;
    const item = option === null ? undefined : painted[Number(option.dataset["pal"])];
    if (item !== undefined) deps.run(item);
  });

  return {
    reset() {
      mounted = false;
      painted = [];
      index = 0;
    },
    chosen: () => paletteChoice(painted, index).item,
    count: () => painted.length,
    paint(state) {
      const { palette } = state;
      if (palette === null) return;
      if (!mounted) {
        root.innerHTML = SHELL;
        mounted = true;
        root.querySelector<HTMLInputElement>("#pal-q")?.focus();
      }
      painted = paletteItems(state, palette.query);
      index = paletteChoice(painted, palette.index).index;
      const list = root.querySelector<HTMLElement>("#pal-list");
      if (list !== null) list.innerHTML = paletteOptions(painted, index).text;
      const input = root.querySelector<HTMLInputElement>("#pal-q");
      if (painted.length > 0) input?.setAttribute("aria-activedescendant", `pal-${index}`);
      else input?.removeAttribute("aria-activedescendant");
      root.querySelector<HTMLElement>(`#pal-${index}`)?.scrollIntoView({ block: "nearest" });
    },
  };
}
