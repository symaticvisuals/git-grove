/** The row `delta` away from `current` in `rows`, held at the ends; the first row when none is selected; null for no rows. */
export function adjacentRow(rows: readonly string[], current: string | null, delta: 1 | -1): string | null {
  const at = current === null ? -1 : rows.indexOf(current);
  if (at < 0) return rows[0] ?? null;
  return rows[Math.max(0, Math.min(rows.length - 1, at + delta))] ?? null;
}
