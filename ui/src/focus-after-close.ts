/**
 * The `data-key`s to give focus back to when the scrim closes, in order: the element that opened it, then, for the
 * agent guard's dialog, whose opener (the card) may be gone, the sidebar's guard status.
 */
export function focusAfterClose(owner: "dialog" | "guard" | "palette" | null, opener: string | null): string[] {
  return [...(opener === null ? [] : [opener]), ...(owner === "guard" ? ["side:guard"] : [])];
}
