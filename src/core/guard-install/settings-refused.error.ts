import { willNotEdit } from "./will-not-edit.js";

/** A settings file grove leaves alone at write time, such as one made read-only since the review; `problem` follows "It". */
export class SettingsRefusedError extends Error {
  constructor(
    readonly path: string,
    readonly problem: string,
  ) {
    super(willNotEdit(path, problem));
    this.name = "SettingsRefusedError";
  }
}
