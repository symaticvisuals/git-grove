import type { Receipt } from "../core/actions/plan.types.js";

/** Renders a receipt: its title, its lines, the pins the run took (or found already in place) and the command that undoes it. */
export function renderReceipt(receipt: Receipt): string {
  const lines = [`${receipt.ok ? "✓" : "✖"} ${receipt.title}`, ...receipt.lines.map((line) => `  ${line}`)];
  for (const pin of receipt.pins) lines.push(pin.reused ? `  already pinned at ${pin.ref}` : `  pinned ${pin.ref}`);
  for (const target of receipt.undo ?? []) lines.push(`  undo: git grove restore ${target.branch} ${target.pinRef}`);
  return `${lines.join("\n")}\n`;
}
