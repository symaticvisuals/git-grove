import type { Server } from "node:http";
import { PortsInUseError } from "./ports-in-use.error.js";

const TRIES = 20;
const HOST = "127.0.0.1";

function listen(server: Server, port: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      if ("code" in error && error.code === "EADDRINUSE") resolve(null);
      else reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

/**
 * Listens on 127.0.0.1 at `port`, or the next free port of the 20 from `port` up, and resolves to the port taken.
 * Port 0 takes whatever port the system gives. Throws PortsInUseError when all 20 are taken.
 */
export async function listenOnFreePort(server: Server, port: number): Promise<number> {
  const last = port === 0 ? 0 : Math.min(port + TRIES - 1, 65535);
  for (let candidate = port; candidate <= last; candidate++) {
    const taken = await listen(server, candidate);
    if (taken !== null) return taken;
  }
  throw new PortsInUseError(port, last);
}
