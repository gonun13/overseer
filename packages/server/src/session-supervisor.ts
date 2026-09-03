import type {
  AdapterSessionStore,
  AgentAdapter,
  AgentEvent,
  PermissionMode,
  PlanMeta,
  PlanStatusOverride,
  SessionHandle,
  SessionMeta,
  ServerMessage,
} from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import {
  loopSessionIndex,
  loopSessionName,
  sweepDeadLoopSessions,
} from "./loop-sessions.js";
import {
  readPlanStore,
  readSnapshot,
  recordAction,
  rememberPlans,
  setPlanOverride,
  type WorldSnapshot,
} from "./memory/internal.js";
import { mergePlans } from "./plan-registry.js";
import { isInsideWorkspace } from "./workspace.js";

type Broadcast = (message: ServerMessage) => void;

interface LiveSession {
  handle: SessionHandle;
  meta: SessionMeta;
  pump: Promise<void>;
  lastActivityAt: number;
  /** The session store this session was opened under — fixed for its
   * lifetime, so a provider switch mid-session does not redirect its own
   * title lookups or exit-time list refresh onto a different adapter's
   * store. */
  store: AdapterSessionStore;
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
  /** Live dev-loop runs, keyed by the session id each one opened. */
  loopSessionIndex?: typeof loopSessionIndex;
  /** Delete the transcripts of loop runs that have ended. */
  sweepDeadLoopSessions?: typeof sweepDeadLoopSessions;
  readPlanStore?: typeof readPlanStore;
  rememberPlans?: typeof rememberPlans;
  setPlanOverride?: typeof setPlanOverride;
}

export function createSessionSupervisor(
  broadcast: Broadcast,
  deps: SessionSupervisorDeps = {},
) {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;
  const recordActionFn = deps.recordAction ?? recordAction;
  const loopSessionIndexFn = deps.loopSessionIndex ?? loopSessionIndex;
  const sweepDeadLoopSessionsFn =
    deps.sweepDeadLoopSessions ?? sweepDeadLoopSessions;
  const readPlanStoreFn = deps.readPlanStore ?? readPlanStore;
  const rememberPlansFn = deps.rememberPlans ?? rememberPlans;
  const setPlanOverrideFn = deps.setPlanOverride ?? setPlanOverride;

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
      const sessions = await mergeList(entry.meta.projectDir, entry.store);
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
    | { ok: true; adapter: AgentAdapter; store: AdapterSessionStore; projectPath: string }
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
    if (adapter.sessions === undefined) {
      return { ok: false, reason: `${providerId} cannot manage sessions` };
    }
    return { ok: true, adapter, store: adapter.sessions, projectPath };
  }

  async function mergeList(
    projectPath: string,
    store: AdapterSessionStore,
  ): Promise<SessionMeta[]> {
    const dormant = await store.listProjectSessions(projectPath);
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

  /** Every plan the active project's transcripts hold, with the operator's
   * own verdicts folded in. Returns the list as well as broadcasting it, so
   * `implement` can find one plan without a second read of every file. */
  async function mergePlanList(
    projectPath: string,
    store: AdapterSessionStore,
  ): Promise<PlanMeta[]> {
    // An adapter with no plan step reports none rather than failing the call:
    // the plans window is a real, empty surface under cursor, not an error.
    const read = (await store.listProjectPlans?.(projectPath)) ?? [];
    // Remembered before it is merged, so a plan survives the deletion of the
    // session that produced it — see `plan-registry.ts`.
    await rememberPlansFn(read);
    const [remembered, sessions] = await Promise.all([
      readPlanStoreFn(),
      mergeList(projectPath, store),
    ]);
    return mergePlans(read, remembered, sessions, projectPath);
  }

  async function pushPlans(
    projectPath: string,
    store: AdapterSessionStore,
  ): Promise<PlanMeta[]> {
    const plans = await mergePlanList(projectPath, store);
    broadcast({ type: "plan.list", plans });
    return plans;
  }

  function startPump(
    sessionId: string,
    handle: SessionHandle,
    meta: SessionMeta,
    store: AdapterSessionStore,
  ) {
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
          if (event.type === "session.mode") {
            // Same idea as `session.model`, for a confirmed `set_permission_mode`.
            meta.permissionMode = event.mode;
            meta.lastActiveAt = event.timestamp;
            pushMeta({ ...meta });
          }
          if (event.type === "turn.end") {
            // An interrupted turn reports a zeroed result — keep the running
            // total rather than resetting the session's cost to nothing.
            if (event.totalCostUsd > 0) meta.totalCostUsd = event.totalCostUsd;
            meta.lastActiveAt = event.timestamp;
            const title = await store.lookupSessionTitle(
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
            void mergeList(projectPath, store).then(pushList);
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

    const turns = await ctx.store.readSessionHistory(ctx.projectPath, sessionId);
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

    const dormant = await ctx.store.listProjectSessions(ctx.projectPath);
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

    const pump = startPump(sessionId, handle, meta, ctx.store);
    track(sessionId, { handle, meta, pump, lastActivityAt: Date.now(), store: ctx.store });
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

  // Named rather than returned inline: the plan operations below are built
  // out of the session ones (open, send, mode) and need to call them through
  // the same public path a socket frame would.
  const supervisor = {
    async list(): Promise<SessionResult> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;
      // Before listing, not after: a finished loop run's transcript is refuse,
      // and the operator should never be shown a row for one.
      await sweepDeadLoopSessionsFn(ctx.store.deleteSession);
      const sessions = await mergeList(ctx.projectPath, ctx.store);
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

      // Both shipped adapters mint locally today (see AdapterSessionStore's
      // doc comment), but the interface stays async for a future provider
      // whose id must round-trip its own CLI — kept behind the same
      // defensive catch `openSession` already has below, not a bare `await`
      // that would reject this whole method and leave the operator's click
      // answered by nothing at all.
      let sessionId: string;
      try {
        sessionId = await ctx.store.mintSessionId();
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : "could not mint a session id",
        };
      }

      let handle: SessionHandle;
      try {
        handle = await ctx.store.openSession(sessionId, {
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

      const pump = startPump(sessionId, handle, meta, ctx.store);
      track(sessionId, { handle, meta, pump, lastActivityAt: Date.now(), store: ctx.store });

      pushMeta(meta);
      const sessions = await mergeList(ctx.projectPath, ctx.store);
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
        const turns = await ctx.store.readSessionHistory(ctx.projectPath, sessionId);
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

    /** Retarget an already-running session's next turn's permission mode.
     * Resumes a dormant session first, the same as `setModel`. */
    async setPermissionMode(
      sessionId: string,
      mode: PermissionMode,
    ): Promise<SessionResult> {
      let entry = live.get(sessionId);
      if (entry === undefined) {
        const opened = await ensureOpen(sessionId);
        if (!opened.ok) return opened;
        entry = live.get(sessionId);
      }
      if (entry === undefined) {
        return { ok: false, reason: "session could not be opened" };
      }
      entry.handle.setPermissionMode(mode);
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
      const sessions = await mergeList(entry.meta.projectDir, entry.store);
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
        await ctx.store.deleteSession(ctx.projectPath, sessionId);
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : "could not delete session",
        };
      }

      const sessions = await mergeList(ctx.projectPath, ctx.store);
      pushList(sessions);

      void recordActionFn({
        actor: "operator",
        action: "session:delete",
        outcome: "ok",
        detail: `${ctx.adapter.id} · ${sessionId}`,
      });

      return { ok: true };
    },

    /** Plans for the active project, broadcast like the session list. */
    async listPlans(): Promise<SessionResult> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;
      await pushPlans(ctx.projectPath, ctx.store);
      return { ok: true };
    },

    /** Retire a plan by hand, or (with `"open"`) hand it back to what its
     * transcript says. */
    async setPlanStatus(
      planId: string,
      status: PlanStatusOverride,
    ): Promise<SessionResult> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;
      await setPlanOverrideFn(planId, status);
      await pushPlans(ctx.projectPath, ctx.store);
      void recordActionFn({
        actor: "operator",
        action: "plan:status",
        outcome: "ok",
        detail: `${planId} · ${status}`,
      });
      return { ok: true };
    },

    /**
     * Continue a plan where it was made.
     *
     * The session that proposed the plan is holding the context that produced
     * it, so implementing it anywhere else throws that away. It is also, as
     * far as the operator is concerned, where the output belongs: they clicked
     * a plan and expect that conversation to carry on. A session whose
     * transcript has since been deleted is the one case that cannot be
     * resumed — there, a new session is started and the plan text is carried
     * into it, since nothing else remembers it.
     *
     * Leaving `plan` mode is part of implementing: a session still in it would
     * answer the implement turn with another plan.
     */
    async implementPlan(planId: string): Promise<SessionResult> {
      const ctx = await adapterContext();
      if (!ctx.ok) return ctx;

      const plans = await mergePlanList(ctx.projectPath, ctx.store);
      const plan = plans.find((candidate) => candidate.id === planId);
      if (plan === undefined) {
        return { ok: false, reason: "plan not found" };
      }

      const loops = await loopSessionIndexFn();
      const lease = loops.get(plan.sessionId);
      if (lease !== undefined) {
        return {
          ok: false,
          reason: `'${lease.slug}' is a live loop run — open its console instead`,
        };
      }

      let sessionId = plan.sessionId;
      let text = RESUME_PLAN_PROMPT;
      if (!plan.sessionExists) {
        const created = await supervisor.create({ permissionMode: "acceptEdits" });
        if (!created.ok || created.sessionId === undefined) {
          return created.ok ? { ok: false, reason: "could not start a session" } : created;
        }
        sessionId = created.sessionId;
        text = seedPlanPrompt(plan.body);
      } else {
        const opened = await supervisor.open(sessionId);
        if (!opened.ok) return opened;
        // Best effort: a provider that refuses the control request still gets
        // the turn, and the prompt says plainly that the planning is over.
        await supervisor.setPermissionMode(sessionId, "acceptEdits");
      }

      const sent = await supervisor.send(sessionId, text);
      if (!sent.ok) return sent;

      broadcast({ type: "plan.implementing", planId, sessionId });
      await pushPlans(ctx.projectPath, ctx.store);

      void recordActionFn({
        actor: "operator",
        action: "plan:implement",
        outcome: "ok",
        detail: `${planId} · ${sessionId}`,
      });

      return { ok: true };
    },
  };

  return supervisor;
}

/** Sent into the session that proposed the plan — it still has the plan in
 * its own transcript, so repeating the text back at it would only crowd the
 * context that makes it worth resuming. */
const RESUME_PLAN_PROMPT =
  "Implement the plan you proposed earlier in this session. Work through it end to end — do not re-plan it.";

/** For a session that has never seen the plan, because the one that wrote it
 * is gone. */
function seedPlanPrompt(body: string): string {
  return `Implement this plan end to end — it was approved already, so do not re-plan it.\n\n${body}`;
}

export function sessionError(about: string, reason: string): ServerMessage {
  return {
    type: "error",
    about,
    benign: true,
    message: reason,
  };
}
