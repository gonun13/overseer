import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import {
  isClientMessage,
  type DiscoveryEvent,
  type ServerMessage,
} from "@overseer/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { listAdapters } from "./adapters.js";
import { consoleError, createConsoleSession } from "./console.js";
import { runDiscovery } from "./discovery.js";
import { createProviderOptions } from "./provider-options.js";
import {
  cancelLogin,
  currentAuthState,
  signOut as runSignOut,
  startLogin,
  submitCode,
} from "./login.js";
import {
  createSessionSupervisor,
  sessionError,
} from "./session-supervisor.js";
import {
  clearActionRegister,
  clearRunLogs,
  clearSnapshot,
  readSnapshot,
  recordAction,
  setActiveProjectPath,
  setAttachedProvider,
  setTheme,
} from "./memory/internal.js";
import {
  deletePersonalityConfig,
  peekPersonality,
  setOperatorName,
  setOperatorTone,
} from "./memory/personality/api.js";
import {
  beginIntentionalPersonalityDelete,
  endIntentionalPersonalityDelete,
} from "./personality-file-watcher.js";
import { refreshPendingUsage } from "./usage-refresh.js";
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

/**
 * The pass in flight, if any — single-flight per process, not per socket.
 *
 * What a guard here protects is process-wide: the world snapshot and the run
 * log. A per-connection flag does not protect them, because two tabs (or a
 * reload whose old socket has not been reaped yet — that is up to two
 * `HEARTBEAT_MS` beats) each get their own flag and both passes run, read the
 * same `previous`, and write two snapshots that record two boots as one.
 *
 * A second asker is not refused, though. It is sent the events of the pass
 * that is already running, because a refusal it cannot act on leaves that tab
 * watching a step that will never resolve. The client paces what it receives,
 * so a tab that joined late still watches the pass rather than being handed a
 * finished world in one frame.
 */
let inFlight: Promise<DiscoveryEvent[]> | undefined;

function discoveryFailure(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "discovery failed for an unknown reason";
}

/**
 * Between the delete steps of a reset.
 *
 * Four `rm` calls finish faster than a frame, and the client does not pace
 * `overseer.step` the way it paces discovery — so without this the operator
 * asks to erase the overseer and is handed a finished list. The teardown is
 * the one report they cannot go back and read afterwards.
 */
const RESET_STEP_MS = 1100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetFailure(error: unknown): string {
  return error instanceof Error ? error.message : "could not erase";
}

export function attachWebSocketServer(httpServer: Server): {
  wss: WebSocketServer;
  broadcast: (message: ServerMessage) => void;
  /** Rebuild and broadcast the sessions list — for monitors that notice
   * sessions the supervisor did not start (transcript-monitor.ts). */
  refreshSessions: () => Promise<unknown>;
} {
  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (message: ServerMessage) => {
    const raw = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(raw);
    }
  };

  const sessionSupervisor = createSessionSupervisor(broadcast);
  const providerOptions = createProviderOptions();

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

    // One raw CLI console per socket. Torn down with the connection so a
    // closed tab cannot leave a `claude` TUI running in the container.
    const consoleSession = createConsoleSession(send);
    ws.on("close", () => consoleSession.dispose());

    // Welcome needs returning + name before discovery runs, so load both here
    // rather than waiting for the pass. Theme comes from the same snapshot.
    // Peek never scaffolds.
    void (async () => {
      const [snapshot, personality] = await Promise.all([
        readSnapshot(),
        peekPersonality(),
      ]);
      if (ws.readyState !== ws.OPEN) return;
      send({
        type: "connected",
        serverTime: new Date().toISOString(),
        returning: snapshot !== undefined,
        ...(Object.keys(personality).length > 0 ? { personality } : {}),
        ...(snapshot?.theme !== undefined ? { theme: snapshot.theme } : {}),
      });
      // A tab opened while a login is in flight has to see the same URL and the
      // same phase as the one that started it — otherwise "join, don't refuse"
      // only holds for a tab that happens to click the button again.
      const auth = currentAuthState();
      if (auth !== undefined) send(auth);
      void sessionSupervisor.list();
    })();

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
              benign: true,
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
              benign: true,
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
          void sessionSupervisor.list();
          return;
        }
        case "theme.select": {
          const result = await setTheme(parsed.theme);
          if (!result.ok) {
            send({
              type: "error",
              about: "theme.select",
              benign: true,
              message: result.reason,
            });
            return;
          }
          send({ type: "theme.selected", theme: parsed.theme });
          return;
        }
        case "provider.connect": {
          const known = listAdapters().some((a) => a.id === parsed.id);
          if (!known) {
            send({
              type: "error",
              about: "provider.connect",
              benign: true,
              message: `unknown provider: ${parsed.id}`,
            });
            return;
          }
          const ok = await setAttachedProvider(parsed.id);
          if (!ok) {
            send({
              type: "error",
              about: "provider.connect",
              benign: true,
              message: "provider can only be attached after discovery",
            });
            return;
          }
          send({ type: "provider.connected", id: parsed.id });
          void sessionSupervisor.list();
          return;
        }
        // Auth state always goes out on `broadcast`, never on `send`: a login
        // finished in one tab has to land in every tab. The only per-socket
        // frame is the replay a joiner gets, which the broker sends itself.
        case "auth.start": {
          const result = startLogin(parsed.providerId, broadcast, send);
          if (!result.ok) {
            send({
              type: "error",
              about: "auth.start",
              benign: true,
              message: result.reason,
            });
          }
          return;
        }
        case "auth.code": {
          // Straight through. The server does not trim, split on `#`,
          // URL-decode or otherwise touch the operator's paste — the CLI
          // validates it, and a mangled one fails blaming their copy/paste.
          const result = submitCode(parsed.code);
          if (!result.ok) {
            send({
              type: "error",
              about: "auth.code",
              benign: true,
              message: result.reason,
            });
          }
          return;
        }
        case "auth.cancel": {
          const result = cancelLogin();
          if (!result.ok) {
            send({
              type: "error",
              about: "auth.cancel",
              benign: true,
              message: result.reason,
            });
          }
          return;
        }
        case "auth.signout": {
          const result = await runSignOut(parsed.providerId, broadcast);
          if (!result.ok) {
            send({
              type: "error",
              about: "auth.signout",
              benign: true,
              message: result.reason,
            });
          }
          return;
        }
        case "memory.reset": {
          // A pass in flight ends by writing a fresh snapshot. Let it land
          // first, or the overseer wakes up remembering the world it was just
          // asked to forget.
          if (inFlight !== undefined) {
            try {
              await inFlight;
            } catch {
              // The pass already reported itself; the wipe does not care how
              // it ended, only that it is over.
            }
          }

          // Written before the register is erased, so a wipe that fails
          // halfway still leaves the reason it started in the trail.
          await recordAction({
            actor: "operator",
            action: "overseer:reset",
            outcome: "ok",
            detail: "internal memory · personality.json",
          });

          let failure: string | undefined;
          const erase = async (label: string, work: () => Promise<void>) => {
            if (failure !== undefined) return;
            try {
              await work();
            } catch (error) {
              failure = resetFailure(error);
            }
            send({
              type: "overseer.step",
              id: randomUUID(),
              label,
              outcome: failure === undefined ? "ok" : "failed",
              ...(failure !== undefined ? { detail: failure } : {}),
            });
            await delay(RESET_STEP_MS);
          };

          // External memory first. The action register is cleared before the
          // final "erasing memory" (snapshot) step so the lines these deletes
          // write about themselves do not survive as the new instance's first
          // memory — except when a wipe fails mid-way, which is the one case
          // worth keeping the trail.
          //
          // The personality watcher must not treat this delete as an accident
          // — otherwise the operations window gets a second, blocked
          // "personality deleted · restart to restore" under the wipe.
          beginIntentionalPersonalityDelete();
          try {
            await erase("deleting personality", async () => {
              const result = await deletePersonalityConfig();
              if (!result.ok) throw new Error(result.reason);
            });
            await erase("erasing run logs", clearRunLogs);
            await erase("erasing action register", clearActionRegister);
            await erase("erasing memory", clearSnapshot);
          } finally {
            endIntentionalPersonalityDelete();
          }

          if (failure !== undefined) {
            // Not benign: memory the operator was told would be gone is still
            // there, and the client must say so instead of reloading into a
            // boot that would quietly contradict it.
            send({
              type: "error",
              about: "memory.reset",
              message: `reset failed · ${failure}`,
            });
            return;
          }

          send({ type: "memory.reset.done" });
          return;
        }
        case "discovery.run": {
          const running = inFlight;
          if (running !== undefined) {
            // Join the pass instead of starting a second one. Whatever it
            // emitted before this socket asked is replayed, so the operations
            // window still reads as a run rather than starting mid-list.
            try {
              for (const event of await running) send(event);
            } catch (error) {
              send({
                type: "error",
                about: "discovery.run",
                message: discoveryFailure(error),
              });
            }
            return;
          }

          const pass = runDiscovery(send);
          inFlight = pass;
          try {
            await pass;
            // Auth returned with `usageState: "pending"`; ask `/usage` now so
            // the widget can leave "retrieving…" without blocking discovery.
            refreshPendingUsage();
          } catch (error) {
            send({
              type: "error",
              about: "discovery.run",
              message: discoveryFailure(error),
            });
          } finally {
            // Joiners already hold the promise, so clearing here only stops
            // the *next* request from riding a pass that has finished.
            inFlight = undefined;
          }
          return;
        }
        case "console.open": {
          const result = await consoleSession.open(
            parsed.cols,
            parsed.rows,
            parsed.mode,
            parsed.takeover,
          );
          // Suffix the mode so a refusal lands in the window that asked —
          // a socket can hold both a raw CLI console and a loop console.
          if (!result.ok) {
            send(
              consoleError(
                parsed.mode === "loop" ? "console.open.loop" : "console.open",
                result.reason,
              ),
            );
          }
          return;
        }
        case "console.input": {
          const result = consoleSession.input(parsed.id, parsed.data);
          if (!result.ok) send(consoleError("console.input", result.reason));
          return;
        }
        case "console.resize": {
          const result = consoleSession.resize(
            parsed.id,
            parsed.cols,
            parsed.rows,
          );
          if (!result.ok) send(consoleError("console.resize", result.reason));
          return;
        }
        case "console.close": {
          const result = consoleSession.close(parsed.id);
          if (!result.ok) send(consoleError("console.close", result.reason));
          return;
        }
        case "provider.options": {
          const result = await providerOptions.read();
          if (!result.ok) {
            send({
              type: "error",
              about: "provider.options",
              benign: true,
              message: result.reason,
            });
            return;
          }
          // Broadcast: what the provider offers is a fact about the instance,
          // not about the socket that asked, and a second tab must not have to
          // spawn the CLI again to learn it.
          broadcast({
            type: "provider.options",
            providerId: result.providerId,
            projectDir: result.projectDir,
            options: result.options,
          });
          return;
        }
        case "session.list": {
          const result = await sessionSupervisor.list();
          if (!result.ok) send(sessionError("session.list", result.reason));
          return;
        }
        case "session.create": {
          const result = await sessionSupervisor.create({
            model: parsed.model,
            permissionMode: parsed.permissionMode,
            agent: parsed.agent,
            name: parsed.name,
          });
          if (!result.ok) send(sessionError("session.create", result.reason));
          return;
        }
        case "session.open": {
          const result = await sessionSupervisor.open(parsed.sessionId);
          if (!result.ok) send(sessionError("session.open", result.reason));
          return;
        }
        case "session.send": {
          const result = await sessionSupervisor.send(parsed.sessionId, parsed.text);
          if (!result.ok) send(sessionError("session.send", result.reason));
          return;
        }
        case "session.model": {
          const result = await sessionSupervisor.setModel(
            parsed.sessionId,
            parsed.model,
          );
          if (!result.ok) send(sessionError("session.model", result.reason));
          return;
        }
        case "session.interrupt": {
          const result = sessionSupervisor.interrupt(parsed.sessionId);
          if (!result.ok) {
            send(sessionError("session.interrupt", result.reason));
          }
          return;
        }
        case "session.close": {
          const result = await sessionSupervisor.close(parsed.sessionId);
          if (!result.ok) send(sessionError("session.close", result.reason));
          return;
        }
        case "session.delete": {
          const result = await sessionSupervisor.delete(parsed.sessionId);
          if (!result.ok) send(sessionError("session.delete", result.reason));
          return;
        }
      }
    });
  });

  return {
    wss,
    broadcast,
    refreshSessions: () => sessionSupervisor.list(),
  };
}
