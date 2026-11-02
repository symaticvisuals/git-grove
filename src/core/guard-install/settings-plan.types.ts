/**
 * A change to a settings file's text: `refused` when the text cannot be read (`problem` follows "It"), `unchanged`
 * when there is nothing to do, or `change`, with the new `text`, the JSON it `adds` and `removes`, and whether the
 * rest of the file is rewritten with 2-space indentation (`reformats`).
 */
export type SettingsPlan =
  | { kind: "refused"; problem: string }
  | { kind: "unchanged" }
  | { kind: "change"; text: string; adds: unknown; removes: unknown[]; reformats: boolean };
