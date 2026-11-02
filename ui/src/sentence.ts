/** `text` as a sentence: a capital first letter and a closing full stop. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
