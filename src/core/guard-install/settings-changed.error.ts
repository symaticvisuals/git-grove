import { basename } from "node:path";

/** The settings file is not the one a review showed: it changed after the plan read it. */
export class SettingsChangedError extends Error {
  constructor(readonly path: string) {
    super(`${basename(path)} changed since the review; review again`);
    this.name = "SettingsChangedError";
  }
}
