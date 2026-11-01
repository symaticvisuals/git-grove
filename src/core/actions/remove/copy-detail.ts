import { formatSize } from "./format-size.js";
import type { PlannedCopy } from "./read-removal.js";

/** A planned copy's step detail: its size, and the name it takes in main when that differs. */
export function copyDetail(copy: PlannedCopy): string {
  const parts = [...(copy.size === null ? [] : [formatSize(copy.size)]), ...(copy.to === copy.from ? [] : [`as ${copy.to}`])];
  return parts.join(", ");
}
