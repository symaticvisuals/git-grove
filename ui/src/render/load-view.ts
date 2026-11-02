import { html, type SafeHtml } from "../html.js";
import type { SliceName } from "../slice-names.js";
import type { Load } from "../state.js";
import { failed } from "./failed.js";
import { loading } from "./loading.js";

/**
 * A slice through its states: loading while there is nothing to show, the error with Try again when a load failed
 * (above the last data, when there is some), otherwise `show` with the data. `place` names where it is shown when
 * the same slice is shown twice.
 */
export function loadView<T>(load: Load<T> | null, slice: SliceName, show: (data: T) => SafeHtml, place: string = slice): SafeHtml {
  if (load === null || load.status === "loading") return loading();
  if (load.status === "ready") return show(load.data);
  return load.data === null ? failed(load.message, slice, place) : html`${failed(load.message, slice, place)}${show(load.data)}`;
}
