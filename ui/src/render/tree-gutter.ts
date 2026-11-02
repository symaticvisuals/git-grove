import { html, raw, type SafeHtml } from "../html.js";

const STEP = 22;
const MID = 20;
const ROW = 40;

const column = (depth: number): number => 7 + Math.max(0, depth - 1) * STEP;

function hasLaterSibling(rows: readonly { depth: number }[], index: number): boolean {
  const depth = rows[index]?.depth ?? 0;
  for (const row of rows.slice(index + 1)) {
    if (row.depth < depth) return false;
    if (row.depth === depth) return true;
  }
  return false;
}

function ancestor(rows: readonly { depth: number }[], index: number, depth: number): number {
  for (let at = index - 1; at >= 0; at--) if (rows[at]?.depth === depth) return at;
  return -1;
}

/**
 * The stack-tree cell of row `index` among `rows` (depth 0 for a row outside a stack): an elbow from its parent's
 * column, a line on down when a later sibling follows, a line down to its own first child, and the lines of
 * ancestors that still have siblings below. `icon` (14×14) sits on the row's own column. The cell's width comes
 * from the SVG's attributes, so it needs no inline style.
 */
export function treeGutter(rows: readonly { depth: number }[], index: number, icon: SafeHtml = raw("")): SafeHtml {
  const depth = rows[index]?.depth ?? 0;
  const lines: string[] = [];
  if (depth > 0) {
    for (let through = 2; through < depth; through++) {
      const holder = ancestor(rows, index, through);
      if (holder >= 0 && hasLaterSibling(rows, holder)) lines.push(`M${column(through - 1)} 0 V${ROW}`);
    }
    if (depth > 1) {
      const parent = column(depth - 1);
      lines.push(`M${parent} 0 V${MID - 6} A6 6 0 0 0 ${parent + 6} ${MID} H${column(depth) - 10}`);
      if (hasLaterSibling(rows, index)) lines.push(`M${parent} ${MID - 6} V${ROW}`);
    }
    if ((rows[index + 1]?.depth ?? 0) > depth) lines.push(`M${column(depth)} ${MID + 10} V${ROW}`);
  }
  const own = column(Math.max(depth, 1));
  const width = own + 7;
  const paths = lines.map((d) => html`<path d="${d}" fill="none" stroke="var(--line-hi)" stroke-width="1.5" stroke-linecap="round"/>`);
  return html`<span class="tcell"><svg class="gut" width="${width}" height="${ROW}" viewBox="0 0 ${width} ${ROW}" aria-hidden="true">${paths}<g transform="translate(${own - 7} 13)">${icon}</g></svg></span>`;
}
