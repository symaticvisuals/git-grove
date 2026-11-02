/** Where Tab (or Shift+Tab, `back`) moves focus among `count` controls from `current` (-1 for none), wrapping at both ends; null when there are none. */
export function cycleFocus(current: number, count: number, back: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return back ? count - 1 : 0;
  return (current + (back ? count - 1 : 1)) % count;
}
