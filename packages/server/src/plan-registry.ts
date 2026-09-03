import type { AdapterPlan, PlanMeta, SessionMeta } from "@overseer/protocol";
import type { PlanStore } from "./memory/internal.js";

/**
 * The plans list for one project: what the transcripts say now, what this
 * instance remembers, and what the operator has said about either.
 *
 * Three rules, and they are the whole of the plans feature's judgement:
 *
 * 1. A plan read from a transcript wins over the remembered copy — the
 *    transcript is live and the memory is a snapshot.
 * 2. A remembered plan whose transcript is gone is still listed. Deleting a
 *    session must not silently delete the plan it produced; the plan's status
 *    freezes at whatever the last read saw, and implementing it starts a new
 *    session (`sessionExists: false`).
 * 3. An operator's verdict beats both. A plan they marked done stays done even
 *    if the session goes on to edit more files — "done" is a statement about
 *    their intent, not about the transcript.
 */
export function mergePlans(
  read: AdapterPlan[],
  store: PlanStore,
  sessions: SessionMeta[],
  projectDir: string,
): PlanMeta[] {
  const byId = new Map(read.map((plan) => [plan.id, plan]));
  for (const [id, entry] of Object.entries(store)) {
    if (byId.has(id)) continue;
    if (entry.plan?.projectDir !== projectDir) continue;
    byId.set(id, entry.plan);
  }

  const known = new Set(sessions.map((session) => session.id));
  return [...byId.values()]
    .map((plan) => ({
      ...plan,
      status: store[plan.id]?.override ?? plan.derived,
      sessionExists: known.has(plan.sessionId),
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}
