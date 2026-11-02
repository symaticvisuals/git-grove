import { html, type SafeHtml } from "../html.js";

function pattern(names: readonly string[]): RegExp | null {
  const words = [...new Set(names)].filter((name) => name !== "").sort((a, b) => b.length - a.length);
  if (words.length === 0) return null;
  const escaped = words.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w./-])(?:${escaped.join("|")})(?![\\w/-])`, "g");
}

/** `text` with each of `names` that stands as a whole word shown as a code chip, longest names first; everything is escaped. */
export function nameChips(text: string, names: readonly string[]): SafeHtml {
  const found = pattern(names);
  if (found === null) return html`${text}`;
  const parts: SafeHtml[] = [];
  let at = 0;
  for (const match of text.matchAll(found)) {
    parts.push(html`${text.slice(at, match.index)}<code>${match[0]}</code>`);
    at = match.index + match[0].length;
  }
  return html`${parts}${text.slice(at)}`;
}
