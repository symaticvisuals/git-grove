/** The receipt title and lines for a run refused because another grove action holds the repo lock at `lockPath`. */
export function lockedRefusal(lockPath: string): { title: string; lines: string[] } {
  return {
    title: "Another grove action is running in this repo",
    lines: [
      `${lockPath} is held. Wait for that action to finish, then try again.`,
      `If no grove action is running, remove ${lockPath} and try again.`,
    ],
  };
}
