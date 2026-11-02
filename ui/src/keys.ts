/**
 * A key press as the keyboard map reads it. `typing` is focus in a text field, select or text area; `onControl` is
 * focus on a button, link, select, text area or disclosure, which handles Enter itself; `onRow` is focus on a list row.
 */
export type KeyInput = { key: string; meta: boolean; ctrl: boolean; alt: boolean; typing: boolean; onControl: boolean; onRow: boolean };

export type KeyMode = "page" | "dialog" | "palette";

export type KeyCommand = "palette" | "close" | "confirm" | "up" | "down" | "run-item" | "new" | "quick" | "restack" | "ack" | "next" | "prev";

const PAGE: Record<string, KeyCommand> = { n: "new", r: "quick", s: "restack", a: "ack", j: "next", k: "prev" };

/**
 * What a key does where focus is. ⌘K or Ctrl-K opens the palette from anywhere and closes it again. In the palette
 * the arrows move, Enter runs and Esc closes; in a dialog Esc closes and Enter confirms unless a control has focus.
 * On the page, outside a text field and without a modifier: N new feature, R the selected row's fix, S restack,
 * A keep, j and k (or the arrows, from a row) move the selection. Anything else is null.
 */
export function keyCommand(input: KeyInput, mode: KeyMode): KeyCommand | null {
  const { key } = input;
  if ((input.meta || input.ctrl) && !input.alt && key.toLowerCase() === "k") return mode === "palette" ? "close" : "palette";
  if (mode === "palette") {
    if (key === "Escape") return "close";
    if (key === "ArrowDown") return "down";
    if (key === "ArrowUp") return "up";
    return key === "Enter" ? "run-item" : null;
  }
  if (mode === "dialog") {
    if (key === "Escape") return "close";
    return key === "Enter" && !input.onControl ? "confirm" : null;
  }
  if (input.typing || input.meta || input.ctrl || input.alt) return null;
  if (input.onRow && key === "ArrowDown") return "next";
  if (input.onRow && key === "ArrowUp") return "prev";
  return key.length === 1 ? (PAGE[key.toLowerCase()] ?? null) : null;
}
