/** `count` with `word`, adding an s unless the count is one: `1 commit`, `3 commits`. */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
