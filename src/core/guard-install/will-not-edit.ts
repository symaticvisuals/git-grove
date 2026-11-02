/** That grove leaves a settings file it cannot read alone, and why: `problem` follows "It". */
export function willNotEdit(settingsPath: string, problem: string): string {
  return `grove will not edit ${settingsPath}: it ${problem}.`;
}
