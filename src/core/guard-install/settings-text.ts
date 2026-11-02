/** Settings as grove writes them: JSON with 2-space indentation and a final newline. */
export function settingsText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
