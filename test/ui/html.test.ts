import { expect, test } from "vitest";
import { html, raw } from "../../ui/src/html.js";

test("a value is escaped, so an agent-written tag renders as text", () => {
  expect(html`<b>${"<img src=x onerror=alert(1)>"}</b>`.text).toBe("<b>&lt;img src=x onerror=alert(1)&gt;</b>");
});

test('attribute values escape " as &quot; and \' as &#39;', () => {
  expect(html`<span title="${`a"b'c&d`}"></span>`.text).toBe('<span title="a&quot;b&#39;c&amp;d"></span>');
});

test("raw() and nested html pass through unescaped", () => {
  const inner = html`<i>${"<x>"}</i>`;
  expect(html`<b>${inner}${raw("<br>")}</b>`.text).toBe("<b><i>&lt;x&gt;</i><br></b>");
});

test("arrays join, numbers print, and false, null and undefined render nothing", () => {
  const items = ["<a>", "b"].map((item) => html`<li>${item}</li>`);
  expect(html`<ul>${items}</ul>${3}${false}${null}${undefined}`.text).toBe("<ul><li>&lt;a&gt;</li><li>b</li></ul>3");
});
