/** `1 commit`, `2 commits`: the count and the noun, with an `s` unless the count is one. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
