/** Where the first change grove makes to an existing settings file keeps it for good: `<settings>.grove-original`. */
export function settingsOriginalPath(settingsPath: string): string {
  return `${settingsPath}.grove-original`;
}
