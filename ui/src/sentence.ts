/**
 * `text` as a sentence: a capital first letter and a closing full stop. A first word that is a name keeps its case:
 * one of `names`, or one with a `/`, `.`, `_`, `-`, `@` or digit in it, such as a branch, ref, path or file.
 */
export function sentence(text: string, names: readonly string[] = []): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const first = (trimmed.split(/\s/, 1)[0] ?? "").replace(/[,;:]$/, "");
  const named = names.includes(first) || /[/._@\d-]/.test(first);
  const head = named ? trimmed : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(head) ? head : `${head}.`;
}
