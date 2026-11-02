const STOP = 1_000_000;

function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === "{") depth++;
    else if (text[at] === "}" && --depth === 0) return at;
  }
  return -1;
}

function topLevelCommas(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < inner.length; at++) {
    const c = inner[at];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

function alternatives(inner: string): number {
  const numbers = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(inner);
  if (numbers !== null) {
    const step = Math.abs(Number(numbers[3] ?? 1)) || 1;
    return Math.floor(Math.abs(Number(numbers[2]) - Number(numbers[1])) / step) + 1;
  }
  const letters = /^([A-Za-z])\.\.([A-Za-z])$/.exec(inner);
  if (letters !== null) return Math.abs((letters[2] ?? "").charCodeAt(0) - (letters[1] ?? "").charCodeAt(0)) + 1;
  const parts = topLevelCommas(inner);
  return parts.length < 2 ? 1 : parts.reduce((sum, part) => Math.min(STOP, sum + countBraceExpansions(part)), 0);
}

/**
 * How many words the shell's brace expansion makes of `word`: `{a,b}` is 2, `{1..9}{1..9}` is 81, and braces with
 * neither a comma nor a range count as 1. Counting stops past a million.
 */
export function countBraceExpansions(word: string): number {
  let total = 1;
  for (let at = 0; at < word.length && total <= STOP; at++) {
    if (word[at] !== "{") continue;
    const close = closingBrace(word, at);
    if (close === -1) break;
    total *= alternatives(word.slice(at + 1, close));
    at = close;
  }
  return Math.min(total, STOP + 1);
}
