import { realpath } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isClientMessage,
  type DiscoveryEvent,
  type DiscoveryOutcome,
  type ServerMessage,
  type SpaceOutcome,
} from "@overseer/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { listAdapters } from "./adapters.js";
import {
  consoleError,
  createConsoleRegistry,
  type ConsoleRegistry,
} from "./console-registry.js";
import { runDiscovery } from "./discovery.js";
import {
  buildStatusEntry,
  createOverseerSpace,
  type OverseerSpace,
} from "./overseer/space.js";
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
import { createSessionIndex } from "./session-index.js";
import { createCallsignBook } from "./callsigns.js";
import { createRelay, type Relay } from "./relay.js";
import {
  clearActionRegister,
  clearCallsigns,
  clearRunLogs,
  clearSnapshot,
  readSnapshot,
  setProviderStatus,
  recordAction,
  readGitIdentity,
  setActiveProjectPath,
  setAttachedProvider,
  setGitIdentity,
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
import {
  gitSsh,
  parseRemoteHost,
  projectGit,
  type GitOpResult,
} from "./vcs/index.js";
import { isInsideWorkspace, scanWorkspace } from "./workspace.js";

/**
 * Any page in the browser can otherwise open a socket to localhost — check
 * Origin on the upgrade (spec/architecture.md §6).
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
 * space rows the way it paces discovery — so without this the operator
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

/**
 * The three-stage containment check every per-file read in a project goes
 * through, before anything on disk is touched. Returns the project's real
 * directory, or sends the refusal and returns `undefined`.
 *
 * Shared by `project.git.show` and `project.git.list` rather than written
 * twice: this is the security contract, and a second copy of it is a second
 * thing to keep correct.
 *
 * Stage one is workspace containment for the project itself. Stage two
 * resolves `relative` against the *real* project directory and checks again —
 * the frame guard proved the value is relative and free of `..`, which is not
 * the same as proving where it lands once joined. That check is lexical rather
 * than another `isInsideWorkspace`, which realpaths its candidate and so
 * requires the path to exist: a deleted file is precisely the case an operator
 * most wants a diff for, and it has nothing left on disk to resolve. Stage
 * three, for anything still on disk, re-resolves through symlinks — a name
 * that lands inside the project can still *point* outside it, and reading
 * content follows links, so `ln -s /etc/passwd notes.md` inside a project
 * would otherwise be served verbatim. (Git needs no such guard: it records a
 * symlink as its target string, so a diff shows the link, never what it aims
 * at.)
 */
async function resolveInProject(
  projectPath: string,
  relative: string,
  about: string,
  send: (message: ServerMessage) => void,
): Promise<string | undefined> {
  const refuse = (message: string) => {
    send({ type: "error", about, benign: true, message });
    return undefined;
  };

  if (!(await isInsideWorkspace(projectPath))) {
    return refuse("a project must be a path inside the workspace");
  }

  let projectDir: string;
  try {
    projectDir = await realpath(projectPath);
  } catch {
    return refuse("that project is no longer on disk");
  }

  const target = path.resolve(projectDir, relative);
  if (!target.startsWith(projectDir + path.sep)) {
    return refuse("a file must be inside the project");
  }

  try {
    const real = await realpath(target);
    if (!real.startsWith(projectDir + path.sep)) {
      return refuse("a file must be inside the project");
    }
  } catch {
    // Not on disk — nothing to resolve, and nothing to leak.
  }

  return projectDir;
}

/**
 * The `overseer` command agents relay with (spec/behaviour/relay.md §5.1).
 * Resolved from this module, which sits one level under `packages/server` in
 * both `src/` and `dist/`.
 */
const RELAY_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../relay-bin",
);

export function attachWebSocketServer(
  httpServer: Server,
  opts: { hookBase?: string } = {},
): {
  wss: WebSocketServer;
  /** Every console the server runs — `index.ts` routes CLI hooks into it. */
  consoles: ConsoleRegistry;
  broadcast: (message: ServerMessage) => void;
  /** The overseer space, for the monitors `index.ts` starts alongside. */
  space: OverseerSpace;
  /** Rebuild and broadcast the sessions list — for the monitor that notices
   * a transcript change (transcript-monitor.ts). */
  refreshSessions: () => Promise<unknown>;
  /** Callsign relay — `index.ts` routes agents' `/relay` requests into it. */
  relay: Relay;
} {
  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (message: ServerMessage) => {
    const raw = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(raw);
    }
  };

  /**
   * Agent callsigns and the relay that types prompts into them
   * (spec/behaviour/relay.md). Built around the registry and the session
   * index; each closure reads the others lazily.
   */
  const callsigns = createCallsignBook({
    exists: (key) =>
      consoles.list().some((c) => c.id === key || c.sessionId === key) ||
      sessionIndex.current().some((s) => s.id === key),
  });

  const consoles = createConsoleRegistry({
    broadcast,
    ...(opts.hookBase !== undefined ? { hookBase: opts.hookBase } : {}),
    callsigns,
    relayBin: RELAY_BIN,
    onActivity: (id, activity) => relay.onActivity(id, activity),
    onExit: (id) => relay.onExit(id),
    // A session whose CLI never wrote a transcript — opened and closed
    // without a turn — is gone with its console, and so is its name.
    onDismiss: (info) => {
      if (info.sessionId === undefined) return;
      if (sessionIndex.current().some((s) => s.id === info.sessionId)) return;
      callsigns.release(info.sessionId);
    },
  });

  /**
   * The one door every service reports to the operator through. Created here
   * because `broadcast` is here; handed to the monitors from `index.ts`.
   */
  const space = createOverseerSpace(broadcast);

  const sessionIndex = createSessionIndex(broadcast, {
    isRunning: (sessionId) => consoles.findBySession(sessionId) !== undefined,
    callsignOf: (sessionId) => callsigns.nameOf(sessionId),
    onDelete: (sessionId) => callsigns.release(sessionId),
  });

  const relay = createRelay({
    consoles,
    callsigns,
    sessions: () => sessionIndex.current(),
    space,
    broadcast,
  });
  const usageCheck = createUsageCheck();

  /**
   * Records and broadcasts one git action (commit/push/merge/revert) —
   * broadcast rather than sent to the asking socket alone, since a change to
   * the project's git state is a fact any tab with that project's window
   * open should see, the same reasoning `workspace-membership-worker.ts`
   * broadcasts project add/remove rows. This is also what "highlights" the
   * overseer for the operator: a fresh space `event` row raises the OVERSEER
   * window on its own (`useShellPresentation.ts`).
   */
  const announceGitOp = (
    verb: string,
    projectPath: string,
    result: GitOpResult,
    action: string,
    detail: string,
  ) => {
    const name = path.basename(projectPath);
    // A git operation is something that happened, not a condition that holds —
    // an `event` row, so a second commit lands under the first instead of
    // replacing it.
    space.status({
      service: "git",
      key: action,
      mode: "event",
      label: `${verb} ${name}`,
      outcome: gitStepOutcome(result),
      detail: result.ok ? detail : result.reason,
      action,
      actor: "operator",
    });
  };

  /**
   * The whole `git access` section as one frame.
   *
   * The host list is derived from the remotes the workspace actually uses
   * rather than a fixed set of public forges: a self-hosted GitLab on a
   * non-default port is exactly the case an ssh key is most needed for, and a
   * hardcoded github/gitlab menu would never offer it. Only ssh remotes
   * contribute — an https one cannot use the key at all.
   */
  const readGitAccess = async (): Promise<ServerMessage> => {
    const [state, identity, scan] = await Promise.all([
      gitSsh.status(),
      readGitIdentity(),
      scanWorkspace(undefined, { git: false }),
    ]);

    const seen = new Map<string, { host: string; port?: number }>();
    await Promise.all(
      scan.projects.map(async (project) => {
        try {
          const { stdout } = await projectGit.remoteUrl(project.path);
          const parsed = parseRemoteHost(stdout);
          if (parsed) seen.set(`${parsed.host}:${parsed.port ?? ""}`, parsed);
        } catch {
          // A project with no origin is ordinary, not an error.
        }
      }),
    );

    return {
      type: "git.access.state",
      ...(state.key ? { key: state.key } : {}),
      permissionsOk: state.permissionsOk,
      ...(identity ? { identity } : {}),
      hosts: [...seen.values()].sort((a, b) => a.host.localeCompare(b.host)),
    };
  };

  /** A key appearing or disappearing is machine state every tab must see —
   * the same reasoning the auth frames are broadcast under. */
  const announceGitAccess = async () => broadcast(await readGitAccess());

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

    /**
     * The git status of one project, as its own frame.
     *
     * Two callers want the identical frame — the client asking for it, and a
     * fetch that has just changed the answer — and the window keys on the path
     * rather than on having asked, so an unsolicited one lands the same way.
     */
    const sendGitStatus = async (projectPath: string) => {
      const result = await projectGit.status(projectPath);
      const defaultBranch = await projectGit.defaultBranch(projectPath);
      // The origin URL is for the window to display, and only this frame wants
      // it — asking for it inside `status()` would spend a spawn on every
      // `push` and `merge`, which read that status only for the branch name.
      // Read here, beside `defaultBranch`, for the same reason and in the same
      // shape. A project with no `origin` (or one whose only remote is named
      // something else) is ordinary, not an error, so a failure just leaves the
      // URL out.
      let remoteUrl: string | undefined;
      if (result.hasRemote) {
        try {
          remoteUrl = (await projectGit.remoteUrl(projectPath)).stdout;
        } catch {
          // No origin to name — `hasRemote` still stands on its own.
        }
      }
      send({
        type: "project.git.status",
        path: projectPath,
        ...result,
        ...(remoteUrl !== undefined ? { remoteUrl } : {}),
        defaultBranch,
      });
    };

    /**
     * Fetch this project's current branch, then say what that changed.
     *
     * Nothing else in this app fetches, so `origin/<branch>` only moves when
     * something pushes or pulls — which means the ahead/behind counts a window
     * shows can be arbitrarily old, and "0 behind" can mean "nobody has looked
     * since Tuesday". Selecting a project is the moment worth spending a
     * network round trip on: it is the point where the operator starts
     * believing what the window says.
     *
     * Reported through the space, because this is the app going out to the
     * network on its own initiative. Unannounced work that changes what the
     * window says is the thing the status list exists to prevent — and a
     * fetch that *fails* is exactly when the counts on screen stop meaning
     * what they appear to mean, so silence is worst precisely when it matters.
     *
     * One `state` row, keyed `remote` rather than per project: only one project
     * is active at a time, so the condition being described is "how the project
     * you are looking at stands against its remote", and the next selection
     * corrects it rather than stacking a second line.
     */
    const refreshFromRemote = async (projectPath: string) => {
      const name = path.basename(projectPath);
      const report = (outcome: SpaceOutcome, detail?: string) =>
        space.status({
          service: "git",
          key: "remote",
          mode: "state",
          label: `checking origin for ${name}`,
          outcome,
          ...(detail !== undefined ? { detail } : {}),
        });

      try {
        const { branch, hasRemote } = await projectGit.status(projectPath);
        if (!hasRemote) {
          report("skipped", "no remote to check");
          return;
        }

        report("running", `${branch} · asking origin`);
        if (!(await projectGit.fetchBranch(projectPath, branch))) {
          // The counts on screen are now known-stale rather than merely old,
          // and that is worth the operator's attention: it is the difference
          // between "0 behind" meaning something and meaning nothing.
          report(
            "failed",
            `could not reach origin · showing the last known ${branch}`,
          );
          return;
        }

        const fresh = await projectGit.status(projectPath);
        await sendGitStatus(projectPath);
        const behind = fresh.behind ?? 0;
        report(
          behind > 0 ? "blocked" : "ok",
          behind > 0
            ? `origin/${branch} has ${behind} commit${behind === 1 ? "" : "s"} this checkout does not`
            : `${branch} is up to date with origin`,
        );
      } catch {
        // Not a repository, or git is unavailable — `project.git.status` is
        // where that gets reported, on the frame the client actually asked for.
        report("skipped", "not a git repository");
      }
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

    // Catch the new tab up on the space. Only `state` rows and the last
    // message — event history belongs to the run that produced it, and a tab
    // that just opened has no business being shown a git commit from before
    // it existed.
    const replayed = space.replay();
    if (replayed.entries.length > 0 || replayed.message !== undefined) {
      send({ type: "space.replay", ...replayed });
    }

    // Consoles outlive the socket: a closed tab only stops watching them.
    ws.on("close", () => consoles.detachAll(send));
    send({ type: "console.list", consoles: consoles.list() });

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
      const held = relay.held();
      if (held.length > 0) send({ type: "relay.held", held });
      void sessionIndex.list();
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
      // (spec/architecture.md §1.2) joins this switch rather than replacing it.
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
          // Ask the remote where it is, now that this is the project being
          // looked at. Not awaited: an unreachable remote must not hold up the
          // selection, and the window opens on the local view either way — the
          // fresh status arrives as its own frame when the fetch lands.
          void refreshFromRemote(parsed.path);
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
            await sendGitStatus(parsed.path);
          } catch (error) {
            send({
              type: "error",
              about: "project.git.status",
              benign: true,
              message:
                error instanceof Error
                  ? error.message
                  : "could not read git status",
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
        case "project.git.pull": {
          if (!(await isInsideWorkspace(parsed.path))) {
            send({
              type: "error",
              about: "project.git.pull",
              benign: true,
              message: "a project must be a path inside the workspace",
            });
            return;
          }
          const result = await projectGit.pull(parsed.path);
          announceGitOp(
            "pulling",
            parsed.path,
            result,
            "project:pull",
            result.ok
              ? `merged ${result.merged} commit${result.merged === 1 ? "" : "s"} from origin/${result.branch}`
              : "",
          );
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.pull",
              benign: result.benign,
              message: result.reason,
            });
            // A conflicted merge changed the working tree and then stopped.
            // The window has to be told, or it goes on showing the clean tree
            // this pull just ended — the conflicted files are the whole point.
            await sendGitStatus(parsed.path).catch(() => undefined);
            return;
          }
          send({
            type: "project.git.pulled",
            path: parsed.path,
            branch: result.branch,
            merged: result.merged,
          });
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
          const result = await projectGit.mergeToDefault(parsed.path);
          announceGitOp(
            "merging",
            parsed.path,
            result,
            "project:merge",
            result.ok ? `merged into ${result.into}` : "merge",
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
          send({
            type: "project.git.merged",
            path: parsed.path,
            branch: result.from,
            into: result.into,
          });
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
        case "project.git.show": {
          const projectDir = await resolveInProject(
            parsed.path,
            parsed.file,
            "project.git.show",
            send,
          );
          if (projectDir === undefined) return;
          // Deliberately no `announceGitOp`: this reads, it does not act, and
          // a broadcast step per file click would raise the overseer's own
          // window every time an operator glanced at a diff.
          const result =
            parsed.mode === "content"
              ? await projectGit.readFile(projectDir, parsed.file)
              : await projectGit.diffFile(
                  projectDir,
                  parsed.file,
                  parsed.previousPath,
                );
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.show",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          send({
            type: "project.git.show",
            path: parsed.path,
            file: parsed.file,
            mode: parsed.mode,
            text: result.text,
            truncated: result.truncated,
          });
          return;
        }
        case "project.git.list": {
          // Same containment contract as `show`, and the same silence: a
          // listing is a read, so nothing is announced for it.
          const projectDir = await resolveInProject(
            parsed.path,
            parsed.folder,
            "project.git.list",
            send,
          );
          if (projectDir === undefined) return;
          const result = await projectGit.listDir(projectDir, parsed.folder);
          if (!result.ok) {
            send({
              type: "error",
              about: "project.git.list",
              benign: result.benign,
              message: result.reason,
            });
            return;
          }
          send({
            type: "project.git.list",
            path: parsed.path,
            folder: parsed.folder,
            entries: result.entries,
            truncated: result.truncated,
          });
          return;
        }
        case "git.access.read": {
          send(await readGitAccess());
          return;
        }
        case "git.ssh.generate": {
          const result = await gitSsh.generate();
          if (!result.ok) {
            send({
              type: "error",
              about: "git.ssh.generate",
              benign: true,
              message: result.reason,
            });
            return;
          }
          // The fingerprint identifies the key; the key itself is never
          // logged, and there is no path that could read it back.
          const fingerprint = result.state.key?.fingerprint ?? "unknown";
          space.status({
            service: "git",
            key: "ssh-generate",
            mode: "event",
            label: "generated an ssh key",
            outcome: "ok",
            detail: fingerprint,
            action: "git:ssh-generate",
            actor: "operator",
          });
          await announceGitAccess();
          return;
        }
        case "git.ssh.remove": {
          await gitSsh.remove();
          space.status({
            service: "git",
            key: "ssh-remove",
            mode: "event",
            label: "removed the ssh key",
            outcome: "ok",
            detail: "pushes will need a new one",
            action: "git:ssh-remove",
            actor: "operator",
          });
          await announceGitAccess();
          return;
        }
        case "git.ssh.test": {
          // A probe, not a change: recorded, but it earns no step and the
          // result goes only to the tab that asked.
          const result = await gitSsh.test(parsed.host, parsed.port);
          void recordAction({
            actor: "operator",
            action: "git:ssh-test",
            outcome: result.ok ? "ok" : "blocked",
            detail: `${parsed.host} · ${result.message}`,
          });
          send({ type: "git.ssh.test.result", ...result });
          return;
        }
        case "git.identity.set": {
          await setGitIdentity(parsed.name, parsed.email);
          // Also into the container's global git config, so the agent's own
          // commits inside a session carry it too — those are separate child
          // processes that resolve identity for themselves.
          try {
            await projectGit.setGlobalIdentity({
              name: parsed.name,
              email: parsed.email,
            });
          } catch (error) {
            console.error(
              "overseer: could not write the global git identity",
              error,
            );
          }
          await announceGitAccess();
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
            // Scoped to the socket that asked, not broadcast: each of these
            // rows takes a piece of that operator's furniture away as it
            // lands, and another tab is not being erased.
            send({
              type: "space.status",
              entry: buildStatusEntry({
                service: "memory",
                key: "reset",
                mode: "event",
                label,
                outcome: failure === undefined ? "ok" : "failed",
                ...(failure !== undefined ? { detail: failure } : {}),
              }),
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
          // — otherwise the status list gets a second, blocked
          // "personality deleted · restart to restore" under the wipe.
          // The legacy plans file is not part of this socket reset sequence and
          // survives it; `clearInternalMemory` removes it for callers using the
          // aggregate helper.
          beginIntentionalPersonalityDelete();
          try {
            await erase("deleting personality", async () => {
              const result = await deletePersonalityConfig();
              if (!result.ok) throw new Error(result.reason);
            });
            await erase("erasing run logs", clearRunLogs);
            await erase("erasing callsigns", async () => {
              await clearCallsigns();
              // Running consoles keep their names: renaming an agent under
              // the operator mid-turn would be stranger than the reset.
              const running = consoles
                .list()
                .filter((c) => c.status === "running")
                .map((c) => consoles.callsignKeyOf(c.id))
                .filter((key): key is string => key !== undefined);
              callsigns.forget(running);
            });
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
          const { type: _type, reqId, ...request } = parsed;
          const result = await consoles.open(request);
          // Ack only — the window that mounts for this id attaches itself, so
          // its replay lands in a terminal that exists.
          if (result.ok) {
            send({ type: "console.opened", reqId, console: result.console });
          } else {
            send({ type: "console.failed", reqId, reason: result.reason });
          }
          return;
        }
        case "console.attach": {
          const result = consoles.attach(
            parsed.id,
            send,
            parsed.cols,
            parsed.rows,
          );
          if (!result.ok) send(consoleError("console.attach", result.reason));
          return;
        }
        case "console.detach":
          consoles.detach(parsed.id, send);
          return;
        case "console.input": {
          const result = consoles.input(parsed.id, parsed.data);
          if (!result.ok) send(consoleError("console.input", result.reason));
          else relay.noteInput(parsed.id, parsed.data);
          return;
        }
        case "console.resize": {
          const result = consoles.resize(parsed.id, parsed.cols, parsed.rows);
          if (!result.ok) send(consoleError("console.resize", result.reason));
          return;
        }
        case "console.kill":
          consoles.kill(parsed.id);
          return;
        case "console.dismiss":
          consoles.dismiss(parsed.id);
          return;
        case "console.list":
          send({ type: "console.list", consoles: consoles.list() });
          return;
        case "console.relay": {
          const outcome = await relay.relay({
            to: parsed.to,
            text: parsed.text,
            from: { kind: "operator" },
          });
          send({
            type: "console.relayed",
            reqId: parsed.reqId,
            to: outcome.to,
            state: outcome.state,
            ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
          });
          return;
        }
        case "callsign.rename": {
          await callsigns.ready;
          const result = callsigns.rename(parsed.from, parsed.to);
          // Reported where relays are, since the prompt bar has no surface
          // of its own to refuse in (spec/behaviour/relay.md §1.1).
          space.status({
            service: "relay",
            key: "rename",
            mode: "event",
            label: `renaming ${parsed.from.toLowerCase()}...`,
            outcome: result.ok ? "ok" : "failed",
            detail: result.ok
              ? `${parsed.from.toLowerCase()} → ${parsed.to}`
              : result.reason,
            action: "callsign:rename",
            actor: "operator",
          });
          if (!result.ok) return;
          consoles.renameCallsign(result.key, parsed.to);
          await sessionIndex.list();
          return;
        }
        case "relay.release":
          await relay.release(parsed.id, parsed.release);
          return;
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
          const provider = (await readSnapshot())?.providers.find(
            (p) => p.id === result.providerId,
          );
          if (provider?.usageRefresh && provider.status.authenticated) {
            const status = {
              ...provider.status,
              usageState: "ready" as const,
              usage: result.windows,
            };
            await setProviderStatus(result.providerId, status);
            broadcast({
              type: "provider.status",
              id: result.providerId,
              status,
            });
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
        case "session.list":
          await sessionIndex.list();
          return;
        case "session.delete": {
          const result = await sessionIndex.delete(parsed.sessionId);
          if (!result.ok) {
            send({
              type: "error",
              about: "session.delete",
              benign: true,
              message: result.reason,
            });
          }
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
              message:
                error instanceof Error
                  ? error.message
                  : "could not read loop config",
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
              message:
                error instanceof Error
                  ? error.message
                  : "could not set loop provider",
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
              message:
                error instanceof Error
                  ? error.message
                  : "could not set loop model",
            });
            return;
          }
          broadcast(await readLoopConfig());
          return;
        }
        case "loop.models.read": {
          // Provider command failures and invalid JSON become an empty list.
          // A parseable reply with an unexpected nested shape can still throw
          // out of this handler.
          broadcast(await readLoopModels(parsed.providerId));
          return;
        }
      }
    });
  });

  return {
    wss,
    consoles,
    broadcast,
    space,
    refreshSessions: () => sessionIndex.list(),
    relay,
  };
}
