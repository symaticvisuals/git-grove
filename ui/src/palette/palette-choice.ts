import type { PaletteItem } from "./palette-items.js";

/** The selected item of a painted palette list, its index held within the list; null when the list is empty. */
export function paletteChoice(items: readonly PaletteItem[], index: number): { index: number; item: PaletteItem | null } {
  const held = Math.max(0, Math.min(items.length - 1, index));
  return { index: held, item: items[held] ?? null };
}
