/** Lowercases `text` and turns each run of characters outside `a-z0-9` into one `-`, trimmed of leading and trailing ones. */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
