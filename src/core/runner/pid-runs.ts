/** Whether process `pid` runs: signal 0 reaches it, or it runs as a user this process may not signal (EPERM). */
export function pidRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
