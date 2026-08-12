import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { isClientMessage, type ServerMessage } from "@overseer/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { listAdapters } from "./adapters.js";
import { runDiscovery } from "./discovery.js";
import { hasRunBefore, setActiveProjectPath, setAttachedAdapter } from "./memory/internal.js";
import {
  peekPersonality,
  setOperatorName,
  setOperatorTone,
} from "./memory/personality.js";
import { isInsideWorkspace } from "./workspace.js";

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

/**
 * How often to check that the peer is still there.
 *
 * A socket the peer abandoned without a close frame — a tab torn down
 * mid-load, a laptop suspended, the VM paused — stays ESTABLISHED on this side
 * forever, because TCP alone will not say otherwise. Two things then go wrong:
 * this process holds a connection and its fd for a client that is gone, and
 * the *browser* keeps counting that socket against its per-host connection
 * limit, so a later page load can sit queued behind sockets that are already
 * dead. Ping on every beat, drop anything that missed the previous pong.
 */
const HEARTBEAT_MS = 30_000;

export function attachWebSocketServer(httpServer: Server): {
  wss: WebSocketServer;
  broadcast: (message: ServerMessage) => void;
} {
  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (message: ServerMessage) => {
    const raw = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(raw);
    }
  };

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

    // Liveness. `alive` is set by the peer's pong and cleared by our ping, so a
    // beat that finds it still false is a peer that did not answer the last
    // one. `terminate` rather than `close`: there is no one left to complete a
    // closing handshake with.
    let alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    ws.on("close", () => clearInterval(heartbeat));

    // Welcome needs returning + name before discovery runs, so load both here
    // rather than waiting for the pass. Peek never scaffolds.
    void (async () => {
      const [returning, personality] = await Promise.all([
        hasRunBefore(),
        peekPersonality(),
      ]);
      if (ws.readyState !== ws.OPEN) return;
      send({
        type: "connected",
        serverTime: new Date().toISOString(),
        returning,
        ...(Object.keys(personality).length > 0 ? { personality } : {}),
      });
    })();

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
        case "operator.name": {
          const result = await setOperatorName(parsed.name);
          if (!result.ok) {
            send({
              type: "error",
              about: "operator.name",
              message: result.reason,
            });
            return;
          }
          send({ type: "operator.named", name: result.name });
          return;
        }
        case "operator.tone": {
          const result = await setOperatorTone(parsed.tone);
          if (!result.ok) {
            send({
              type: "error",
              about: "operator.tone",
              message: result.reason,
            });
            return;
          }
          send({ type: "operator.toned", tone: result.tone });
          return;
        }
        case "project.select": {
          // `isClientMessage` only proves this is a string. It is the one frame
          // that names a filesystem path, and it is persisted as
          // `last_active_project` and replayed on every later boot — so it is
          // checked here, before internal memory sees it, against the surface
          // the design says is the only shared one. Resolve rather than compare
          // prefixes: `..` and symlinks both survive a string test.
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.select",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          const result = await setActiveProjectPath(parsed.path);
          if (!result.ok) {
            send({
              type: "error",
              about: "project.select",
              benign: true,
              message: result.reason,
            });
            return;
          }
          send({ type: "project.selected", path: parsed.path });
          return;
        }
        case "adapter.connect": {
          const known = listAdapters().some((a) => a.id === parsed.id);
          if (!known) {
            send({
              type: "error",
              about: "adapter.connect",
              message: `unknown adapter: ${parsed.id}`,
            });
            return;
          }
          const ok = await setAttachedAdapter(parsed.id);
          if (!ok) {
            send({
              type: "error",
              about: "adapter.connect",
              message: "adapter can only be attached after discovery",
            });
            return;
          }
          send({ type: "adapter.connected", id: parsed.id });
          return;
        }
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

  return { wss, broadcast };
}
