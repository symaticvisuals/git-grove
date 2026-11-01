/**
 * Where a rescued file goes in the main worktree: `relative` when main has nothing there, else
 * `<relative>.from-<folder>`, else `<relative>.from-<folder>-2`, `-3` and so on.
 */
export function rescueTarget(relative: string, folder: string, existsInMain: (rel: string) => boolean): string {
  if (!existsInMain(relative)) return relative;
  const saved = `${relative}.from-${folder}`;
  if (!existsInMain(saved)) return saved;
  let attempt = 2;
  while (existsInMain(`${saved}-${attempt}`)) attempt++;
  return `${saved}-${attempt}`;
}
