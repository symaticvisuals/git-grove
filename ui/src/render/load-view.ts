import { html, type SafeHtml } from "../html.js";
import type { SliceName } from "../slice-names.js";
import type { Load } from "../state.js";
import { failed } from "./failed.js";
import { loading } from "./loading.js";

/**
 * A slice through its states: loading while there is nothing to show, the error with Try again when a load failed
 * (above the last data, when there is some), otherwise `show` with the data.
 */
export function loadView<T>(load: Load<T> | null, slice: SliceName, show: (data: T) => SafeHtml): SafeHtml {
  if (load === null || load.status === "loading") return loading();
  if (load.status === "ready") return show(load.data);
  return load.data === null ? failed(load.message, slice) : html`${failed(load.message, slice)}${show(load.data)}`;
}
