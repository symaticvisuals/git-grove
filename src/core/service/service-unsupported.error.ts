/** This machine has no launchd or systemd user session to install a login service into; `reason` says what is missing. */
export class ServiceUnsupportedError extends Error {
  constructor(readonly reason: string) {
    super(`git-grove: no launchd or systemd user session here (${reason}); run git grove serve yourself`);
    this.name = "ServiceUnsupportedError";
  }
}
