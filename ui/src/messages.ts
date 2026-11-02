/** The sentences the dashboard shows when it cannot reach git grove, or is not allowed to. */
export const MESSAGES = {
  notRunning: "git grove isn't running. Start it with git grove ui.",
  signedOut: "Open the dashboard from your terminal: git grove ui",
  unexpected: "git grove sent a reply this page doesn't understand. Reload the page.",
} as const;
