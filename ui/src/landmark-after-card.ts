/** Where focus goes when "Not now" takes the agent guard card away: the first row of the list under it, else Scan now. */
export function landmarkAfterCard(rowKeys: readonly string[]): string {
  return rowKeys[0] ?? "bar:scan";
}
