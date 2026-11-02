/** Markup that is safe to put into the page as it is. */
export class SafeHtml {
  constructor(readonly text: string) {}

  toString(): string {
    return this.text;
  }
}

export type HtmlValue = SafeHtml | string | number | false | null | undefined | readonly HtmlValue[];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function textOf(value: HtmlValue): string {
  if (value instanceof SafeHtml) return value.text;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value === null || value === undefined || value === false) return "";
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** A template tag that escapes every value that is not already `SafeHtml`, so text and attribute values cannot become markup. */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((value, index) => {
    out += textOf(value) + (strings[index + 1] ?? "");
  });
  return new SafeHtml(out);
}

/** Trusts `text` as markup; only for markup written in this codebase. */
export function raw(text: string): SafeHtml {
  return new SafeHtml(text);
}
