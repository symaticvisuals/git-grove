const TIMEOUT_MS = 2000;

/**
 * Sends `POST /api/shutdown` to the server on `port` with the `X-Grove-Token` header, so it stops with exit code 75
 * and its login service starts it again. Resolves whether the server accepted (202).
 */
export async function askServerToExit(port: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: "POST",
      headers: { "x-grove-token": token, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.status === 202;
  } catch {
    return false;
  }
}
