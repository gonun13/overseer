import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClientMessage,
  PlanMeta,
  PlanStatus,
  PlanStatusOverride,
  ServerMessage,
} from "@overseer/protocol";
import type { Plan, Session } from "../domain";
import type { Activity } from "../status";

/**
 * The plans the active project's sessions have produced.
 *
 * Server-derived and re-broadcast whenever the transcripts change, so nothing
 * here caches a status of its own: a plan the operator implements flips when
 * the server says it has, not when the button is pressed.
 */
export interface PlansState {
  plans: Plan[];
  /** Ask for a fresh list — the plans window does this when it opens. */
  refresh: () => void;
  /** Continue a plan in the session that built it. */
  implement: (planId: string) => void;
  setStatus: (planId: string, status: PlanStatusOverride) => void;
  /** Last refusal, in the server's words. Cleared by the next good list. */
  error: string | undefined;
}

/** What each status lights as. A plan waiting on the operator is `waiting`
 * for the same reason an approval is: the system has done its part and the
 * next move is theirs. */
const PLAN_ACTIVITY: Record<PlanStatus, Activity> = {
  proposed: "waiting",
  "in-progress": "working",
  superseded: "idle",
  done: "done",
  archived: "idle",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse and short — a row has one line, and a plan's exact minute has never
 * been the thing the operator is deciding on. */
function relativeTime(iso: string, now: number): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

export function usePlans(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  sessions: Session[],
  /** Opens (or raises) the window of the session a plan is being implemented
   * in — the server has already sent the turn there. */
  onImplementing?: (sessionId: string) => void,
): PlansState {
  const [metas, setMetas] = useState<PlanMeta[]>([]);
  const [error, setError] = useState<string>();
  /** Session an implement is waiting to show. Held rather than opened on the
   * spot: a plan whose own session was deleted is implemented in one the
   * server just created, and `plan.implementing` can arrive before that
   * session's own meta has landed in the list. */
  const [pendingSession, setPendingSession] = useState<string>();

  useEffect(() => {
    return subscribe((message) => {
      if (message.type === "plan.list") {
        setError(undefined);
        setMetas(message.plans);
        return;
      }
      if (message.type === "plan.implementing") {
        setPendingSession(message.sessionId);
        return;
      }
      if (
        message.type === "error" &&
        typeof message.about === "string" &&
        message.about.startsWith("plan.")
      ) {
        setError(message.message);
      }
    });
  }, [subscribe]);

  useEffect(() => {
    if (pendingSession === undefined) return;
    if (!sessions.some((session) => session.id === pendingSession)) return;
    onImplementing?.(pendingSession);
    setPendingSession(undefined);
  }, [pendingSession, sessions, onImplementing]);

  const plans = useMemo(() => {
    const now = Date.now();
    const names = new Map(sessions.map((s) => [s.id, s.name]));
    return metas.map((meta): Plan => {
      const session = names.get(meta.sessionId);
      return {
        id: meta.id,
        activity: PLAN_ACTIVITY[meta.status],
        title: meta.title,
        sessionId: meta.sessionId,
        ...(session !== undefined ? { session } : {}),
        status: meta.status,
        when: relativeTime(meta.createdAt, now),
        sessionExists: meta.sessionExists,
      };
    });
  }, [metas, sessions]);

  const refresh = useCallback(() => {
    send({ type: "plan.list" });
  }, [send]);

  const implement = useCallback(
    (planId: string) => {
      setError(undefined);
      send({ type: "plan.implement", planId });
    },
    [send],
  );

  const setStatus = useCallback(
    (planId: string, status: PlanStatusOverride) => {
      send({ type: "plan.status", planId, status });
    },
    [send],
  );

  return { plans, refresh, implement, setStatus, error };
}
