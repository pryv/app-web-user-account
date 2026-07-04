import Pryv from "pryv";
import attachSocketIO from "@pryv/socket.io";
import type { PryvConnection } from "./session";

/** Shape added onto `Pryv.Connection` by the `@pryv/socket.io` add-on. */
interface ConnectionSocket {
  open(): Promise<void>;
  close(): void;
  on(eventName: string, listener: (...args: unknown[]) => void): void;
}

let loaded = false;
function ensureSocketIO(): void {
  if (loaded) return;
  // Requires pryv + @pryv/socket.io ≥ 3.8.0 — earlier type declarations
  // rejected the default export (utils shape drift, fixed upstream).
  attachSocketIO(Pryv);
  loaded = true;
}

/**
 * Open the connection's Socket.IO transport and invoke `onChange` on every
 * `accessesChanged` server notification. Returns a cleanup function closing
 * the socket. Failures are reported through `onUnavailable` (live updates are
 * an enhancement — pages keep their manual Refresh path).
 */
export function subscribeToAccessChanges(
  connection: PryvConnection,
  onChange: () => void,
  onUnavailable?: (err: unknown) => void,
): () => void {
  ensureSocketIO();
  const conn = connection as unknown as { socket?: ConnectionSocket };
  let closed = false;
  const socket = conn.socket;
  if (!socket) {
    onUnavailable?.(new Error("Socket.IO transport not available"));
    return () => {};
  }
  void (async () => {
    try {
      await socket.open();
      if (closed) {
        socket.close();
        return;
      }
      socket.on("accessesChanged", onChange);
      socket.on("error", (err) => onUnavailable?.(err));
    } catch (err) {
      onUnavailable?.(err);
    }
  })();
  return () => {
    closed = true;
    try {
      socket.close();
    } catch {
      // already closed / never opened
    }
  };
}
