import type { DialogContext, DialogSpec, Field, FieldValues } from "../dialogs/dialog-specs.js";
import { html, type SafeHtml } from "../html.js";

function control(field: Field, values: FieldValues, ctx: DialogContext): SafeHtml {
  const id = `dlg-f-${field.name}`;
  const value = values[field.name];
  const current = typeof value === "string" ? value : "";
  const label = html`<label for="${id}">${field.label}</label>`;
  if (field.kind === "select") {
    const options = (field.options?.(ctx) ?? []).map((option) => html`<option value="${option.value}"${option.value === current ? html` selected` : ""}>${option.label}</option>`);
    return html`<div class="field">${label}<select id="${id}" data-field="${field.name}" data-key="dlg:field:${field.name}">${options}</select></div>`;
  }
  return html`<div class="field">${label}<input id="${id}"${field.mono === true ? html` class="mono"` : ""} data-field="${field.name}" data-key="dlg:field:${field.name}" value="${current}" placeholder="${field.placeholder ?? ""}" autocomplete="off" spellcheck="false"></div>`;
}

/**
 * A dialog's text and select fields, laid out as the mockup's forms are: the first on its own line when there is
 * an odd number of them, the rest two to a line. Empty when the dialog has none.
 */
export function renderFields(spec: DialogSpec, values: FieldValues, ctx: DialogContext): SafeHtml {
  const fields = spec.fields.filter((field) => field.kind === "text" || field.kind === "select").map((field) => control(field, values, ctx));
  if (fields.length === 0) return html``;
  const lone = fields.length % 2 === 1 ? fields.slice(0, 1) : [];
  const pairs: SafeHtml[] = [];
  for (let index = lone.length; index < fields.length; index += 2) pairs.push(html`<div class="two">${fields[index]}${fields[index + 1]}</div>`);
  return html`<section class="tight">${lone}${pairs}</section>`;
}
