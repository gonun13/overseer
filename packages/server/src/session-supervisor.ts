import type {
  AgentAdapter,
  AgentEvent,
  PermissionMode,
  SessionHandle,
  SessionMeta,
  ServerMessage,
} from "@overseer/protocol";
import {
  deleteSession,
  listProjectSessions,
  lookupSessionTitle,
  mintSessionId,
  openSession,
  readSessionHistory,
} from "@overseer/adapter-claude-code";
import { getAdapter } from "./adapters.js";
import {
  loopSessionIndex,
  loopSessionName,
  sweepDeadLoopSessions,
} from "./loop-sessions.js";
import {
  readSnapshot,
  recordAction,
  type WorldSnapshot,
} from "./memory/internal.js";
import { isInsideWorkspace } from "./workspace.js";

type Broadcast = (message: ServerMessage) => void;

interface LiveSession {
  handle: SessionHandle;
  meta: SessionMeta;
  pump: Promise<void>;
  lastActivityAt: number;
}

/** Idle sessions are reaped and resumed with `--resume` on the next message. */
const IDLE_REAP_MS = 15 * 60_000;

export type SessionResult = { ok: true } | { ok: false; reason: string };

export interface SessionSupervisorDeps {
  readSnapshot?: () => Promise<WorldSnapshot | undefined>;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
  recordAction?: typeof recordAction;
  /** Override the idle window — tests use a few milliseconds. */
  idleReapMs?: number;
  listProjectSessions?: typeof listProjectSessions;
  readSessionHistory?: typeof readSessionHistory;
  openSession?: typeof openSession;
  mintSessionId?: typeof mintSessionId;
  lookupSessionTitle?: typeof lookupSessionTitle;
  deleteSession?: typeof deleteSession;
  /** Live dev-loop runs, keyed by the session id each one opened. */
  loopSessionIndex?: typeof loopSessionIndex;
  /** Delete the transcripts of loop runs that have ended. */
  sweepDeadLoopSessions?: typeof sweepDeadLoopSessions;
}

export function createSessionSupervisor(
  broadcast: Broadcast,
  deps: SessionSupervisorDeps = {},
) {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;
  const recordActionFn = deps.recordAction ?? recordAction;
  const listProjectSessionsFn =
    deps.listProjectSessions ?? listProjectSessions;
  const readSessionHistoryFn =
    deps.readSessionHistory ?? readSessionHistory;
  const openSessionFn = deps.openSession ?? openSession;
  const mintSessionIdFn = deps.mintSessionId ?? mintSessionId;
  const lookupSessionTitleFn =
    deps.lookupSessionTitle ?? lookupSessionTitle;
  const deleteSessionFn = deps.deleteSession ?? deleteSession;
  const loopSessionIndexFn = deps.loopSessionIndex ?? loopSessionIndex;
  const sweepDeadLoopSessionsFn =
    deps.sweepDeadLoopSessions ?? sweepDeadLoopSessions;

  const idleReapMs = deps.idleReapMs ?? IDLE_REAP_MS;

  const live = new Map<string, LiveSession>();
  const opening = new Map<string, Promise<SessionResult>>();
  const seenPermissions = new Set<string>();

  function pushList(sessions: SessionMeta[]): void {
    broadcast({ type: "session.list", sessions });
  }

  function pushMeta(meta: SessionMeta): void {
    broadcast({ type: "session.meta", session: meta });
  }

  function pushEvent(event: AgentEvent): void {
    broadcast({ type: "session.event", event });
  }

  let reaper: ReturnType<typeof setInterval> | undefined;

  function touch(sessionId: string): void {
    const entry = live.get(sessionId);
    if (entry !== undefined) entry.lastActivityAt = Date.now();
  }

  /** Drop the child process but keep the session resumable from its JSONL. */
  async function reapIdle(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of [...live]) {
      if (now - entry.lastActivityAt < idleReapMs) continue;
      live.delete(id);
      await entry.handle.close();
      entry.meta.status = "dormant";
      pushMeta({ ...entry.meta });
      const sessions = await mergeList(entry.meta.projectDir);
      pushList(sessions);
    }
    if (live.size === 0 && reaper !== undefined) {
      clearInterval(reaper);
      reaper = undefined;
    }
  }

  function startReaper(): void {
    if (reaper !== undefined) return;
    reaper = setInterval(() => {
      void reapIdle();
    }, Math.min(60_000, idleReapMs));
    reaper.unref?.();
  }

  function track(sessionId: string, entry: LiveSession): void {
    live.set(sessionId, entry);
    startReaper();
  }

  async function adapterContext(): Promise<
    | { ok: true; adapter: AgentAdapter; projectPath: string }
    | { ok: false; reason: string }
  > {
    const snapshot = await readSnapshotFn();
    const providerId = snapshot?.attached_provider;
    if (providerId === undefined) {
      return { ok: false, reason: "no provider attached" };
    }
    const projectPath = snapshot?.last_active_project;
    if (projectPath === undefined) {
      return { ok: false, reason: "no active project" };
    }
    if (!(await isInsideWorkspaceFn(projectPath))) {
      return {
        ok: false,
        reason: "active project is not inside the workspace",
      };
    }
    const adapter = getAdapterFn(providerId);
    if (adapter === undefined) {
      return { ok: false, reason: `unknown provider: ${providerId}` };
    }
    let status;
    try {
      status = await adapter.getStatus();
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "could not read provider status",
      };
    }
    if (!status.authenticated) {
      return { ok: false, reason: "provider is not signed in" };
    }
    return { ok: true, adapter, projectPath };
  }

  async function mergeList(projectPath: string): Promise<SessionMeta[]> {
    const dormant = await listProjectSessionsFn(projectPath);
    const byId = new Map(dormant.map((s) => [s.id, s]));
    for (const [id, entry] of live) {
      if (entry.meta.projectDir !== projectPath) continue;
      byId.set(id, { ...entry.meta, status: "live" });
    }

    // A dev-loop run writes its transcript into the same directory the app's
    // own sessions use, so the only thing telling them apart is the loop's
    // lease. Stamped here rather than in the adapter: which sessions belong to
    // a loop is not something a provider can know.
    const loops = await loopSessionIndexFn();
    if (loops.size > 0) {
      for (const [id, meta] of byId) {
        const lease = loops.get(id);
        if (lease === undefined) continue;
        byId.set(id, {
          ...meta,
          // Named after what it is, not after what was said to it. A title
          // resolved from the transcript reads as the loop's kickoff prompt
          // ("Read /app/loop/overseer.md and act…"), which is both unhelpful
          // and identical for every workspace. This matches the console
          // window the row opens, so one run reads the same in both places.
          name: loopSessionName(lease.slug),
          origin: "loop",
          loopWorkspace: lease.slug,
        });
      }
    }

    return [...byId.values()].sort(
      (a, b) =>
        new Date(b.lastActiveAt).getTime() -
        new Date(a.lastActiveAt).getTime(),
    );
  }

  function startPump(sessionId: string, handle: SessionHandle, meta: SessionMeta) {
    const pump = (async () => {
      try {
        for await (const event of handle.events) {
          touch(sessionId);
          if (event.type === "session.init") {
            meta.model = event.model;
            // What the process actually started under, which is not always what
            // we asked for — the CLI's own settings can win.
            if (event.permissionMode !== undefined) {
              meta.permissionMode = event.permissionMode;
            }
            meta.lastActiveAt = event.timestamp;
            pushMeta({ ...meta });
          }
          if (event.type === "session.model") {
            // A runtime `set_model` the CLI confirmed — the session is still
            // the same process, just armed differently for its next turn.
            meta.model = event.model;
            meta.lastActiveAt = event.timestamp;
            pushMeta({ ...meta });
          }
          if (event.type === "turn.end") {
            // An interrupted turn reports a zeroed result — keep the running
            // total rather than resetting the session's cost to nothing.
            if (event.totalCostUsd > 0) meta.totalCostUsd = event.totalCostUsd;
            meta.lastActiveAt = event.timestamp;
            const title = await lookupSessionTitleFn(
              meta.projectDir,
              sessionId,
            );
            if (title !== undefined) meta.name = title;
            pushMeta({ ...meta });
          }
          if (event.type === "permission.request") {
            if (seenPermissions.has(event.requestId)) continue;
            seenPermissions.add(event.requestId);
            // MVP: auto-deny with visible error so the turn can continue.
            handle.resolvePermission(event.requestId, {
              decision: "deny",
              feedback: "Overseer approvals queue is not wired yet",
            });
            pushEvent({
              type: "error",
              sessionId,
              timestamp: new Date().toISOString(),
              message: `permission denied (pending UI): ${event.toolName}`,
              recoverable: true,
            });
            continue;
          }
          if (event.type === "exit") {
            live.delete(sessionId);
            meta.status = "closed";
            pushMeta({ ...meta });
            const projectPath = meta.projectDir;
            void mergeList(projectPath).then(pushList);
          }
          pushEvent(event);
        }
      } catch {
        live.delete(sessionId);
      }
    })();
    return pump;
  }

  async function resumeLiveSession(sessionId: string): Promise<SessionResult> {
    const ctx = await adapterContext();
    if (!ctx.ok) return ctx;

    const existing = live.get(sessionId);
    if (existing !== undefined) return { ok: true };

    const turns = await readSessionHistoryFn(ctx.projectPath, sessionId);
    broadcast({ type: "session.history", sessionId, turns });

    let handle: SessionHandle;
    try {
      handle = await ctx.adapter.resumeSession(sessionId);
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error ? error.message : "could not resume session",
      };
    }

    const dormant = await listProjectSessionsFn(ctx.projectPath);
    const found = dormant.find((s) => s.id === sessionId);
    const meta: SessionMeta = found ?? {
      id: sessionId,
      adapterId: ctx.adapter.id,
      projectDir: ctx.projectPath,
      model: "",
      status: "live",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      totalCostUsd: 0,
    };
    meta.status = "live";

    const pump = startPump(sessionId, handle, meta);
    track(sessionId, { handle, meta, pump, lastActivityAt: Date.now() });
    pushMeta(meta);
    return { ok: true };
  }

  async function ensureOpen(sessionId: string): Promise<SessionResult> {
    const existing = live.get(sessionId);
    if (existing !== undefined) return { ok: true };

    const inflight = opening.get(sessionId);
    if (inflight !== undefined) return inflight;

    const promise = resumeLiveSession(sessionId);
    opening.set(sessionId, promise);
    try {
      return await promise;
    } finally {
      opening.delete(sessionId);
    }
  }

  return {
    async list(): Promise<SessionResult> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;
      // Before listing, not after: a finished loop run's transcript is refuse,
      // and the operator should never be shown a row for one.
      await sweepDeadLoopSessionsFn(deleteSessionFn);
      const sessions = await mergeList(ctx.projectPath);
      pushList(sessions);
      return { ok: true };
    },

    async create(opts: {
      model?: string;
      permissionMode?: PermissionMode;
      agent?: string;
      name?: string;
    }): Promise<SessionResult & { sessionId?: string }> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;

      const sessionId = mintSessionIdFn();

      let handle: SessionHandle;
      try {
        handle = await openSessionFn(sessionId, {
          projectDir: ctx.projectPath,
          model: opts.model,
          permissionMode: opts.permissionMode,
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
          ...(opts.name !== undefined ? { name: opts.name } : {}),
        });
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : "could not start session",
        };
      }

      const meta: SessionMeta = {
        id: sessionId,
        adapterId: ctx.adapter.id,
        name: opts.name,
        projectDir: ctx.projectPath,
        model: opts.model ?? "",
        // What we asked for, if anything. `session.init` replaces it with what
        // the process actually started under.
        ...(opts.permissionMode !== undefined
          ? { permissionMode: opts.permissionMode }
          : {}),
        status: "live",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        totalCostUsd: 0,
      };

      const pump = startPump(sessionId, handle, meta);
      track(sessionId, { handle, meta, pump, lastActivityAt: Date.now() });

      pushMeta(meta);
      const sessions = await mergeList(ctx.projectPath);
      pushList(sessions);

      void recordActionFn({
        actor: "operator",
        action: "session:create",
        outcome: "ok",
        detail: `${ctx.adapter.id} · ${sessionId}`,
      });

      return { ok: true, sessionId };
    },

    async open(sessionId: string): Promise<SessionResult> {
      // A live loop run owns its transcript through an interactive CLI that is
      // still writing it. Resuming would put a second CLI on the same JSONL —
      // there is no lock anywhere to stop that — so refuse before either the
      // backfill or the spawn. The client routes these to the loop's console.
      const loops = await loopSessionIndexFn();
      const lease = loops.get(sessionId);
      if (lease !== undefined) {
        return {
          ok: false,
          reason: `'${lease.slug}' is a live loop run — open its console instead`,
        };
      }

      // `ensureOpen` is a no-op once the process is already live, so a second
      // tab — or the same tab after a reconnect — asking to open a session
      // that never got reaped would otherwise never receive its transcript.
      // Reading it fresh here, on every explicit open, is what makes opening
      // a session idempotent instead of "works once per process lifetime".
      const ctx = await adapterContext();
      if (ctx.ok) {
        const turns = await readSessionHistoryFn(ctx.projectPath, sessionId);
        broadcast({ type: "session.history", sessionId, turns });
      }
      return ensureOpen(sessionId);
    },

    async send(sessionId: string, text: string): Promise<SessionResult> {
      let entry = live.get(sessionId);
      if (entry === undefined) {
        const opened = await ensureOpen(sessionId);
        if (!opened.ok) return opened;
        entry = live.get(sessionId);
      }
      if (entry === undefined) {
        return { ok: false, reason: "session could not be opened" };
      }
      entry.handle.send({
        role: "user",
        content: [{ type: "text", text }],
      });
      entry.meta.lastActiveAt = new Date().toISOString();
      touch(sessionId);
      return { ok: true };
    },

    interrupt(sessionId: string): SessionResult {
      const entry = live.get(sessionId);
      if (entry === undefined) {
        return { ok: false, reason: "session is not live" };
      }
      entry.handle.interrupt();
      return { ok: true };
    },

    /** Retarget an already-running session's next turn. Resumes a dormant
     * session first, the same as `send` — the operator picking a model is not
     * asking to lose the transcript that made them want the picker open. */
    async setModel(sessionId: string, model: string): Promise<SessionResult> {
      let entry = live.get(sessionId);
      if (entry === undefined) {
        const opened = await ensureOpen(sessionId);
        if (!opened.ok) return opened;
        entry = live.get(sessionId);
      }
      if (entry === undefined) {
        return { ok: false, reason: "session could not be opened" };
      }
      entry.handle.setModel(model);
      touch(sessionId);
      return { ok: true };
    },

    async close(sessionId: string): Promise<SessionResult> {
      const entry = live.get(sessionId);
      if (entry === undefined) return { ok: true };
      live.delete(sessionId);
      await entry.handle.close();
      entry.meta.status = "closed";
      pushMeta(entry.meta);
      const sessions = await mergeList(entry.meta.projectDir);
      pushList(sessions);
      return { ok: true };
    },

    /** Stop the process if one is running, then permanently remove the
     * session's transcript — unlike `close`, this does not leave a dormant
     * session behind to resume later. */
    async delete(sessionId: string): Promise<SessionResult> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;

      const entry = live.get(sessionId);
      if (entry !== undefined) {
        live.delete(sessionId);
        await entry.handle.close();
      }

      try {
        await deleteSessionFn(ctx.projectPath, sessionId);
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : "could not delete session",
        };
      }

      const sessions = await mergeList(ctx.projectPath);
      pushList(sessions);

      void recordActionFn({
        actor: "operator",
        action: "session:delete",
        outcome: "ok",
        detail: `${ctx.adapter.id} · ${sessionId}`,
      });

      return { ok: true };
    },
  };
}

export function sessionError(about: string, reason: string): ServerMessage {
  return {
    type: "error",
    about,
    benign: true,
    message: reason,
  };
}
