import { settingsText } from "./settings-text.js";

/** Whether writing `settings` back as grove writes JSON changes more than the final newline of `text`, the file it was read from. */
export function reformats(text: string | null, settings: unknown): boolean {
  return text !== null && text.trim() !== "" && text.trimEnd() !== settingsText(settings).trimEnd();
}
