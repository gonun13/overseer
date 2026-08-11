import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { isClientMessage, type ServerMessage } from "@overseer/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { runDiscovery } from "./discovery.js";

/**
 * Any page in the browser can otherwise open a socket to localhost — check
 * Origin on the upgrade (design doc §6).
 */
function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function attachWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (
      req.url !== "/ws" ||
      !isAllowedOrigin(req.headers.origin, req.headers.host)
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });

  wss.on("connection", (ws: WebSocket) => {
    /** Sending to a socket the operator just closed is normal, not an error. */
    const send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };

    send({ type: "connected", serverTime: new Date().toISOString() });

    // One discovery pass at a time per connection. Without this a client that
    // retries on a slow scan gets two interleaved runs writing two snapshots.
    let discovering = false;

    ws.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send({ type: "error", message: "malformed frame: expected JSON" });
        return;
      }

      if (!isClientMessage(parsed)) {
        const about =
          typeof parsed === "object" && parsed !== null
            ? String((parsed as { type?: unknown }).type ?? "")
            : "";
        send({
          type: "error",
          about: about || undefined,
          message: `unrecognized message type: ${about || "(none)"}`,
        });
        return;
      }

      // Discovery is the first family routed here; the session supervisor
      // (webui design doc §1.2) joins this switch rather than replacing it.
      switch (parsed.type) {
        case "discovery.run": {
          if (discovering) {
            send({
              type: "error",
              about: "discovery.run",
              message: "a discovery pass is already running",
            });
            return;
          }
          discovering = true;
          try {
            await runDiscovery(send);
          } catch (error) {
            send({
              type: "error",
              about: "discovery.run",
              message:
                error instanceof Error
                  ? error.message
                  : "discovery failed for an unknown reason",
            });
          } finally {
            discovering = false;
          }
          return;
        }
      }
    });
  });

  return wss;
}
