/**
 * A key press as the keyboard map reads it. `repeat` is a held key's auto-repeat. `typing` is focus in a text field,
 * select or text area; `submits` is focus in a text field, where Enter means submit; `onControl` is focus on a button,
 * link, select, text area or disclosure, which handles Enter itself; `onRow` and `onGroup` are focus on a list row or
 * a group header.
 */
export type KeyInput = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  repeat: boolean;
  typing: boolean;
  submits: boolean;
  onControl: boolean;
  onRow: boolean;
  onGroup: boolean;
};

export type KeyMode = "page" | "dialog" | "palette";

export type KeyCommand = "palette" | "close" | "confirm" | "up" | "down" | "run-item" | "new" | "quick" | "restack" | "ack" | "next" | "prev" | "fold" | "unfold";

const PAGE: Record<string, KeyCommand> = { n: "new", r: "quick", s: "restack", a: "ack", j: "next", k: "prev" };

function onPage(input: KeyInput): KeyCommand | null {
  const { key } = input;
  const onItem = input.onRow || input.onGroup;
  if (onItem && key === "ArrowDown") return "next";
  if (onItem && key === "ArrowUp") return "prev";
  if (onItem && key === "ArrowLeft") return "fold";
  if (input.onGroup && key === "ArrowRight") return "unfold";
  if (input.repeat || input.typing || input.meta || input.ctrl || input.alt) return null;
  return key.length === 1 ? (PAGE[key.toLowerCase()] ?? null) : null;
}

/**
 * What a key does where focus is. A held key's repeats trigger no shortcut and no Enter; only the arrows repeat.
 * ⌘K or Ctrl-K opens the palette from the page and closes it again; in a dialog it does nothing. In the palette the
 * arrows move, Enter runs and Esc closes. In a dialog Esc closes, and Enter confirms only from a text field: on a
 * button it is the button's own, and from the dialog or the page it does nothing. On the page, outside a text field
 * and without a modifier: N new feature, R the selected row's fix, S restack, A keep, j and k move; from a row or
 * header the up and down arrows move, ← folds its group and → unfolds a folded one. Anything else is null.
 */
export function keyCommand(input: KeyInput, mode: KeyMode): KeyCommand | null {
  const { key } = input;
  if (mode === "palette" && (key === "ArrowDown" || key === "ArrowUp")) return key === "ArrowDown" ? "down" : "up";
  if (input.repeat && !(mode === "page" && key.startsWith("Arrow"))) return null;
  if ((input.meta || input.ctrl) && !input.alt && key.toLowerCase() === "k") {
    if (mode === "dialog") return null;
    return mode === "palette" ? "close" : "palette";
  }
  if (mode === "palette") {
    if (key === "Escape") return "close";
    return key === "Enter" ? "run-item" : null;
  }
  if (mode === "dialog") {
    if (key === "Escape") return "close";
    return key === "Enter" && input.submits ? "confirm" : null;
  }
  return onPage(input);
}
