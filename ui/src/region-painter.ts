import type { SafeHtml } from "./html.js";

export type RegionPainter = (region: HTMLElement | null, content: SafeHtml, context: string) => void;

const TIME_TEXT = /(<time\b[^>]*>)[^<]*(<\/time>)/g;

function focusedKey(region: HTMLElement): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && region.contains(active) ? (active.dataset["key"] ?? null) : null;
}

function keyed(region: HTMLElement, key: string): HTMLElement | null {
  return region.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
}

/**
 * Paints regions of the page. A region is repainted only when its markup changed other than in the clock's times.
 * While `context` stays the same it keeps its scroll; the element that had focus, found again by its `data-key`,
 * keeps it, and so does an open disclosure.
 */
export function createRegionPainter(): RegionPainter {
  const painted = new WeakMap<HTMLElement, { stable: string; context: string }>();
  return (region, content, context) => {
    if (region === null) return;
    const stable = content.text.replace(TIME_TEXT, "$1$2");
    const last = painted.get(region);
    if (last?.stable === stable) return;
    const keep = last?.context === context;
    const list = region.querySelector<HTMLElement>(".list");
    const scroll = { region: region.scrollTop, list: list?.scrollTop ?? 0 };
    const focus = focusedKey(region);
    const open = [...region.querySelectorAll<HTMLElement>("details[open][data-key]")].map((details) => details.dataset["key"] ?? "");
    region.innerHTML = content.text;
    painted.set(region, { stable, context });
    for (const key of open) keyed(region, key)?.setAttribute("open", "");
    if (keep) {
      region.scrollTop = scroll.region;
      const next = region.querySelector<HTMLElement>(".list");
      if (next !== null) next.scrollTop = scroll.list;
    }
    if (focus !== null) keyed(region, focus)?.focus({ preventScroll: true });
  };
}
