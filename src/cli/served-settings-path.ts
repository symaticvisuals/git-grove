const TIMEOUT_MS = 2000;

/** The Claude Code settings file the server on `port` reads the agent guard status from (`GET /api/guard`), or null when it does not say. */
export async function servedSettingsPath(port: number, token: string): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/guard`, { headers: { "x-grove-token": token }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await res.json();
    if (res.status !== 200 || typeof body !== "object" || body === null || !("settingsPath" in body)) return null;
    return typeof body.settingsPath === "string" ? body.settingsPath : null;
  } catch {
    return null;
  }
}
