import { useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@overseer/protocol";

export interface OverseerSocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onConnectionLost: (message: string) => void;
}

/**
 * Owns the `/ws` connection: URL construction, frame parsing, send when open,
 * and deliberate teardown on pagehide/unmount. Does not interpret frames —
 * callers map `ServerMessage` variants to wizard actions.
 */
export function useOverseerSocket(handlers: OverseerSocketHandlers) {
  const socket = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const send = useCallback((message: ClientMessage) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    socket.current = ws;

    // Set whenever *we* discard this socket — pagehide or unmount. Closing
    // fires the same error handler a genuine failure would, and a deliberate
    // teardown is not a fault to report.
    let abandoned = false;

    // Do not time out a CONNECTING socket. When Firefox has exhausted its
    // per-host connection slots, `/ws` sits queued (waterfall: issued ~40s
    // late, handshake then ~10ms). Closing and redialling puts a new request
    // at the back of that queue, burns attempts, and ends the wizard with
    // "could not connect" — the failure mode we hit with a 2s redial. One
    // pending socket is what eventually gets the slot; pagehide below is what
    // stops the next reload from inheriting orphans.

    ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return; // A frame we can't parse is one we can't act on.
      }
      handlersRef.current.onMessage(message);
    });

    // A socket that fails, or that closes before discovery finishes, leaves
    // the operator watching a step that will never resolve — so say so.
    ws.addEventListener("error", () => {
      if (abandoned) return;
      handlersRef.current.onConnectionLost("lost the connection to the server");
    });

    // Reload / navigate without a close frame leaves CONNECTING or ESTABLISHED
    // sockets counted against the per-host limit — the ~40s "connecting" hang
    // on the next load. pagehide is the last reliable chance to free the slot.
    const onPageHide = () => {
      abandoned = true;
      ws.close();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      abandoned = true;
      window.removeEventListener("pagehide", onPageHide);
      socket.current = null;
      ws.close();
    };
  }, []);

  return { send };
}
