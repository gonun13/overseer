import type {
  AgentAdapter,
  SessionMeta,
  ServerMessage,
} from "@overseer/protocol";
import { listAdapters } from "./adapters.js";
import {
  loopSessionIndex,
  loopSessionName,
  sweepDeadLoopSessions,
} from "./loop-sessions.js";
import { recordAction } from "./memory/internal.js";
import { scanWorkspace } from "./workspace.js";

/**
 * Every provider session in the workspace — every project, every provider —
 * read from the transcripts the CLIs themselves write.
 *
 * Overseer no longer runs sessions; consoles do (console-registry.ts). This is
 * only the index the session list is drawn from, rebuilt whenever a transcript
 * changes (transcript-monitor.ts), and the one session operation that is not a
 * console: deleting a transcript.
 */

type Broadcast = (message: ServerMessage) => void;

export type SessionResult = { ok: true } | { ok: false; reason: string };

export interface SessionIndexDeps {
  listAdapters?: () => AgentAdapter[];
  listProjects?: () => Promise<string[]>;
  /** Live dev-loop runs, keyed by the session id each one opened. */
  loopSessionIndex?: typeof loopSessionIndex;
  /** Delete the transcripts of loop runs that have ended. */
  sweepDeadLoopSessions?: typeof sweepDeadLoopSessions;
  /** Whether a console is running this session right now. */
  isRunning?: (sessionId: string) => boolean;
  recordAction?: typeof recordAction;
}

async function defaultListProjects(): Promise<string[]> {
  const scan = await scanWorkspace(undefined, { git: false });
  return scan.projects.map((project) => project.path);
}

export function createSessionIndex(broadcast: Broadcast, deps: SessionIndexDeps = {}) {
  const listAdaptersFn = deps.listAdapters ?? listAdapters;
  const listProjects = deps.listProjects ?? defaultListProjects;
  const loopSessionIndexFn = deps.loopSessionIndex ?? loopSessionIndex;
  const sweep = deps.sweepDeadLoopSessions ?? sweepDeadLoopSessions;
  const isRunning = deps.isRunning ?? (() => false);
  const recordActionFn = deps.recordAction ?? recordAction;

  /** The last list, so a delete knows which adapter and project own an id. */
  let known = new Map<string, SessionMeta>();
  /** Coalesces overlapping rebuilds — a busy transcript fires many. */
  let inFlight: Promise<SessionMeta[]> | undefined;

  async function build(): Promise<SessionMeta[]> {
    const adapters = listAdaptersFn().filter((a) => a.sessions !== undefined);
    const projects = await listProjects();
    const all: SessionMeta[] = [];

    for (const adapter of adapters) {
      const store = adapter.sessions!;
      // Before listing, not after: a finished loop run's transcript is refuse,
      // and the operator should never be shown a row for one.
      await sweep(store.deleteSession).catch(() => []);
      for (const projectDir of projects) {
        try {
          all.push(...(await store.listProjectSessions(projectDir)));
        } catch (error) {
          console.error(`overseer: could not list ${adapter.id} sessions in ${projectDir}`, error);
        }
      }
    }

    // A dev-loop run writes its transcript beside every other session, so the
    // only thing telling them apart is the loop's lease. Stamped here rather
    // than in the adapter: which sessions belong to a loop is not something a
    // provider can know.
    const loops = await loopSessionIndexFn();
    const stamped = all.map((meta) => {
      const lease = loops.get(meta.id);
      if (lease === undefined) return meta;
      return {
        ...meta,
        // Named after what it is, not the loop's kickoff prompt — which is
        // identical for every workspace and says nothing.
        name: loopSessionName(lease.slug),
        origin: "loop" as const,
        loopWorkspace: lease.slug,
      };
    });

    return stamped.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
    );
  }

  async function list(): Promise<SessionMeta[]> {
    if (inFlight === undefined) {
      inFlight = build().finally(() => {
        inFlight = undefined;
      });
    }
    const sessions = await inFlight;
    known = new Map(sessions.map((s) => [s.id, s]));
    broadcast({ type: "session.list", sessions });
    return sessions;
  }

  return {
    list,

    /** Permanently remove a session's transcript. */
    async delete(sessionId: string): Promise<SessionResult> {
      const meta = known.get(sessionId);
      if (meta === undefined) return { ok: false, reason: "no session with that id" };
      if (meta.origin === "loop") {
        return { ok: false, reason: "a live loop run owns this session" };
      }
      if (isRunning(sessionId)) {
        return { ok: false, reason: "a console is running this session — kill it first" };
      }
      const adapter = listAdaptersFn().find((a) => a.id === meta.adapterId);
      if (adapter?.sessions === undefined) {
        return { ok: false, reason: `${meta.adapterId} cannot manage sessions` };
      }
      try {
        await adapter.sessions.deleteSession(meta.projectDir, sessionId);
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : "could not delete session",
        };
      }
      void recordActionFn({
        actor: "operator",
        action: "session:delete",
        outcome: "ok",
        detail: `${meta.adapterId} · ${sessionId}`,
      });
      await list();
      return { ok: true };
    },
  };
}
