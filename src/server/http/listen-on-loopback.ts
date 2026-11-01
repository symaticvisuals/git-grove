import type { Server } from "node:http";
import { PortsInUseError } from "./ports-in-use.error.js";

const TRIES = 20;
const IPV4_LOOPBACK = "127.0.0.1";
const UNAVAILABLE = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

type Outcome = number | "in-use" | "unavailable";

function listen(server: Server, port: number, host: string): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      const code = "code" in error && typeof error.code === "string" ? error.code : "";
      if (code === "EADDRINUSE") resolve("in-use");
      else if (UNAVAILABLE.has(code)) resolve("unavailable");
      else reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Listens on 127.0.0.1 and on `alsoOn` (`::1`) at one port: `port`, or the next of the 20 from it that is free on both.
 * Port 0 lets the system choose, up to 20 times. Where `alsoOn` does not exist (IPv6 off), 127.0.0.1 alone is used.
 * `make` gives a fresh server for each address. Throws PortsInUseError when no port is free on both.
 */
export async function listenOnLoopback(
  make: () => Server,
  port: number,
  alsoOn = "::1",
): Promise<{ port: number; servers: Server[] }> {
  const last = port === 0 ? 0 : Math.min(port + TRIES - 1, 65535);
  const candidates = port === 0 ? Array<number>(TRIES).fill(0) : Array.from({ length: last - port + 1 }, (_, i) => port + i);
  for (const candidate of candidates) {
    const primary = make();
    const taken = await listen(primary, candidate, IPV4_LOOPBACK);
    if (taken === "in-use") continue;
    if (taken === "unavailable") throw new Error(`git-grove: ${IPV4_LOOPBACK} is not available to listen on`);
    const secondary = make();
    const also = await listen(secondary, taken, alsoOn).catch(async (error: unknown) => {
      await close(primary);
      throw error;
    });
    if (also === "in-use") {
      await close(primary);
      continue;
    }
    return { port: taken, servers: also === "unavailable" ? [primary] : [primary, secondary] };
  }
  throw new PortsInUseError(port, last);
}
