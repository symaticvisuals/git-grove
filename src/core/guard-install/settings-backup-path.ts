/** Where a change keeps the settings file as it was: `<settings>.grove-backup`. */
export function settingsBackupPath(settingsPath: string): string {
  return `${settingsPath}.grove-backup`;
}
