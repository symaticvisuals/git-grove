/** `value` as a list of unknown items, or null when it is not an array. */
export function listOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
