export type HealthProbe = { kind: "answered"; pid: number | null } | { kind: "refused" } | { kind: "silent" };

const TIMEOUT_MS = 1000;

function healthPid(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("ok" in value) || !("pid" in value)) return null;
  return value.ok === true && typeof value.pid === "number" ? value.pid : null;
}

function causeCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("cause" in error)) return null;
  const { cause } = error;
  return cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null;
}

/**
 * Asks `127.0.0.1:<port>/api/health` which process serves it, waiting up to 1 s. `answered` carries the pid a grove
 * server gave, or null when something else answered; `refused` means nothing listens there; `silent` is a timeout
 * or any other failure, which proves nothing either way.
 */
export async function probeHealth(port: number): Promise<HealthProbe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = res.ok ? await res.json().catch(() => null) : null;
    return { kind: "answered", pid: healthPid(body) };
  } catch (error) {
    return causeCode(error) === "ECONNREFUSED" ? { kind: "refused" } : { kind: "silent" };
  }
}
