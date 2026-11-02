import { paletteOptions } from "../render/palette-options.js";
import type { State, UiAction } from "../state.js";
import { type PaletteItem, paletteItems } from "./palette-items.js";

export type PaletteDeps = { root: HTMLElement; dispatch(action: UiAction): void; state(): State; run(item: PaletteItem): void };

export type PaletteHost = { paint(state: State): void; reset(): void };

const SHELL =
  '<div class="palette" role="dialog" aria-modal="true" aria-label="Command menu"><input id="pal-q" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-label="Do something, or jump to a branch" placeholder="Do something, or jump to a branch" autocomplete="off" spellcheck="false"><ul id="pal-list" role="listbox" aria-label="Results"></ul></div>';

/**
 * Shows the ⌘K palette in `root`: a query box, written once per opening so typing is never interrupted, over the
 * matching items grouped as Actions then Go to, with the selected one marked for assistive tech and kept in view.
 * Typing filters; clicking an item runs it.
 */
export function createPalette(deps: PaletteDeps): PaletteHost {
  const { root, dispatch } = deps;
  let mounted = false;

  root.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.id === "pal-q") dispatch({ type: "palette-query", query: event.target.value });
  });
  root.addEventListener("click", (event) => {
    const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-pal]") : null;
    const state = deps.state();
    if (option === null || state.palette === null) return;
    const item = paletteItems(state, state.palette.query)[Number(option.dataset["pal"])];
    if (item !== undefined) deps.run(item);
  });

  return {
    reset() {
      mounted = false;
    },
    paint(state) {
      const { palette } = state;
      if (palette === null) return;
      if (!mounted) {
        root.innerHTML = SHELL;
        mounted = true;
        root.querySelector<HTMLInputElement>("#pal-q")?.focus();
      }
      const items = paletteItems(state, palette.query);
      const list = root.querySelector<HTMLElement>("#pal-list");
      if (list !== null) list.innerHTML = paletteOptions(items, palette.index).text;
      const input = root.querySelector<HTMLInputElement>("#pal-q");
      if (items.length > 0) input?.setAttribute("aria-activedescendant", `pal-${palette.index}`);
      else input?.removeAttribute("aria-activedescendant");
      root.querySelector<HTMLElement>(`#pal-${palette.index}`)?.scrollIntoView({ block: "nearest" });
    },
  };
}
