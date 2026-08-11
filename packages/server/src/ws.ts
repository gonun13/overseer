import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

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
    ws.send(JSON.stringify({ type: "connected" }));
    // TODO: route session events / user turns once the session supervisor exists.
  });

  return wss;
}
