/** `word` as one shell word: unchanged when it is plain, otherwise single-quoted. For displayed commands only. */
export function shellWord(word: string): string {
  return /^[\w./@:+-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
