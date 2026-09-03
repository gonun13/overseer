import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import {
  isClientMessage,
  type DiscoveryEvent,
  type DiscoveryOutcome,
  type ServerMessage,
} from "@overseer/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { listAdapters } from "./adapters.js";
import { consoleError, createConsoleSession } from "./console.js";
import { runDiscovery } from "./discovery.js";
import { createProviderOptions } from "./provider-options.js";
import { createUsageCheck } from "./usage-check.js";
import {
  readLoopConfig,
  readLoopModels,
  setLoopModel,
  setLoopProvider,
} from "./loop-config.js";
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
import { createProject } from "./project-create.js";
import { projectGit, type GitOpResult } from "./project-git.js";
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

/** Maps a git op's result onto the one outcome vocabulary every step and
 * signal in the app already shares — a benign refusal (nothing to commit, no
 * remote, already on main) reads as `blocked`, not `failed`: it ran fine and
 * found a reason not to act, the same distinction `DiscoveryOutcome` draws
 * everywhere else. */
function gitStepOutcome(result: GitOpResult): DiscoveryOutcome {
  if (result.ok) return "ok";
  return result.benign ? "blocked" : "failed";
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
  const usageCheck = createUsageCheck();

  /**
   * Records and broadcasts one git action (commit/push/merge/revert) —
   * broadcast rather than sent to the asking socket alone, since a change to
   * the project's git state is a fact any tab with that project's window
   * open should see, the same reasoning `workspace-membership-worker.ts`
   * broadcasts project add/remove steps. This is also what "highlights" the
   * overseer for the operator: a fresh `overseer.step` bumps `operationTick`
   * on the client, which raises the OVERSEER window on its own
   * (`useShellPresentation.ts`).
   */
  const announceGitOp = (
    verb: string,
    projectPath: string,
    result: GitOpResult,
    action: string,
    detail: string,
  ) => {
    const name = path.basename(projectPath);
    const outcome = gitStepOutcome(result);
    void recordAction({
      actor: "operator",
      action,
      outcome,
      detail: `${name} · ${result.ok ? detail : result.reason}`,
    });
    broadcast({
      type: "overseer.step",
      id: randomUUID(),
      label: `${verb} ${name}`,
      outcome,
      detail: result.ok ? detail : result.reason,
    });
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
      void sessionSupervisor.listPlans();
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
          void sessionSupervisor.listPlans();
          return;
        }
        case "project.create": {
          const result = await createProject({
            name: parsed.name,
            folder: parsed.folder,
            description: parsed.description,
          });
          if (!result.ok) {
            send({
              type: "error",
              about: "project.create",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          // No rescan nudge: the root fs.watch + poll in
          // workspace-membership-worker.ts picks the new directory up on its
          // own (~400ms debounce after the watch fires) and broadcasts
          // workspace.projects to every tab. There is no monitor handle
          // reachable from here to force an earlier one anyway —
          // `startWorkspaceMonitor` is wired independently in index.ts.
          send({
            type: "project.created",
            path: result.path,
            name: parsed.name.trim(),
          });
          return;
        }
        case "project.git.status": {
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.git.status",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          try {
            const result = await projectGit.status(parsed.path);
            send({ type: "project.git.status", path: parsed.path, ...result });
          } catch (error) {
            send({
              type: "error",
              about: "project.git.status",
              benign: true,
              message: error instanceof Error ? error.message : "could not read git status",
            });
          }
          return;
        }
        case "project.git.commit": {
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.git.commit",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          const result = await projectGit.commit(parsed.path, parsed.message);
          announceGitOp(
            "committing",
            parsed.path,
            result,
            "project:commit",
            parsed.message,
          );
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.commit",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          send({ type: "project.git.committed", path: parsed.path });
          return;
        }
        case "project.git.push": {
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.git.push",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          const result = await projectGit.push(parsed.path);
          announceGitOp(
            "pushing",
            parsed.path,
            result,
            "project:push",
            "pushed to origin",
          );
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.push",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          send({ type: "project.git.pushed", path: parsed.path });
          return;
        }
        case "project.git.merge": {
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.git.merge",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          const result = await projectGit.mergeToMain(parsed.path);
          announceGitOp(
            "merging",
            parsed.path,
            result,
            "project:merge",
            "merged into main",
          );
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.merge",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          send({ type: "project.git.merged", path: parsed.path, branch: "main" });
          return;
        }
        case "project.git.revert": {
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.git.revert",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          const result = await projectGit.revert(parsed.path);
          announceGitOp(
            "reverting",
            parsed.path,
            result,
            "project:revert",
            "discarded uncommitted changes",
          );
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.revert",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          send({ type: "project.git.reverted", path: parsed.path });
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
        case "provider.checkUsage": {
          const result = await usageCheck.check();
          if (!result.ok) {
            send({
              type: "error",
              about: "provider.checkUsage",
              benign: true,
              message: result.reason,
            });
            return;
          }
          broadcast({
            type: "provider.usageCheck",
            id: result.providerId,
            report: result.report,
            windows: result.windows,
            ...(result.spend !== undefined ? { spend: result.spend } : {}),
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
        case "session.mode": {
          const result = await sessionSupervisor.setPermissionMode(
            parsed.sessionId,
            parsed.mode,
          );
          if (!result.ok) send(sessionError("session.mode", result.reason));
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
        // The loop's own provider/model config — independent of the app's
        // attached provider above. Broadcast, not sent to one socket: a
        // change from any tab has to land in every tab's loop window.
        case "plan.list": {
          const result = await sessionSupervisor.listPlans();
          if (!result.ok) send(sessionError("plan.list", result.reason));
          return;
        }
        case "plan.status": {
          const result = await sessionSupervisor.setPlanStatus(
            parsed.planId,
            parsed.status,
          );
          if (!result.ok) send(sessionError("plan.status", result.reason));
          return;
        }
        case "plan.implement": {
          const result = await sessionSupervisor.implementPlan(parsed.planId);
          if (!result.ok) send(sessionError("plan.implement", result.reason));
          return;
        }
        case "loop.config.read": {
          try {
            broadcast(await readLoopConfig());
          } catch (error) {
            send({
              type: "error",
              about: "loop.config.read",
              benign: true,
              message: error instanceof Error ? error.message : "could not read loop config",
            });
          }
          return;
        }
        case "loop.provider.set": {
          try {
            await setLoopProvider(parsed.id);
          } catch (error) {
            send({
              type: "error",
              about: "loop.provider.set",
              benign: true,
              message: error instanceof Error ? error.message : "could not set loop provider",
            });
            return;
          }
          broadcast(await readLoopConfig());
          return;
        }
        case "loop.model.set": {
          try {
            await setLoopModel(parsed.providerId, parsed.slot, parsed.model);
          } catch (error) {
            send({
              type: "error",
              about: "loop.model.set",
              benign: true,
              message: error instanceof Error ? error.message : "could not set loop model",
            });
            return;
          }
          broadcast(await readLoopConfig());
          return;
        }
        case "loop.models.read": {
          // Never refuses — readLoopModels reports an empty list rather than
          // throwing, so there is no error path to send here (an unreachable
          // or signed-out CLI is a legitimate, displayable answer: "nothing
          // to pick from yet", not a broken request).
          broadcast(await readLoopModels(parsed.providerId));
          return;
        }
      }
    });
  });

  return {
    wss,
    broadcast,
    // Plans are read out of the same transcripts, so whatever wakes the
    // session list wakes them too — a plan proposed in a session Overseer
    // never started still appears.
    refreshSessions: async () => {
      await sessionSupervisor.list();
      await sessionSupervisor.listPlans();
    },
  };
}
