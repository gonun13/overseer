/**
 * Plans — the output of a session run in the `plan` permission mode, lifted
 * back out of the provider's own transcript rather than tracked as it happens.
 *
 * A plan is not a document Overseer owns: it is a thing an agent said in a
 * session, and the session that said it is the only place it can be continued.
 * So a plan carries the session it came from, and every operation on it is an
 * operation on that session.
 */

/**
 * Where a plan stands. The first three are read off the transcript and cannot
 * be set; the last two are the operator retiring a plan by hand.
 *
 * - `proposed`    nothing followed it — the plan is waiting.
 * - `in-progress` the session went on to change files after proposing it.
 * - `superseded`  the same session proposed a newer plan afterwards.
 * - `done`        the operator says it is finished.
 * - `archived`    the operator says it is no longer wanted.
 */
export type PlanStatus =
  | "proposed"
  | "in-progress"
  | "superseded"
  | "done"
  | "archived";

/** The two statuses an operator may set, plus the word that clears an
 * override and hands the plan back to what the transcript says. */
export type PlanStatusOverride = "done" | "archived" | "open";

/** One plan exactly as an adapter read it out of its own transcripts. Status
 * here is derived from the transcript alone: the adapter has no idea what the
 * operator has since said about it. */
export interface AdapterPlan {
  /** The `ExitPlanMode` tool-use id. Stable across rescans, which is what lets
   * an operator override outlive a re-read of the transcript. */
  id: string;
  sessionId: string;
  projectDir: string;
  /** First meaningful line of the plan markdown, for the row. */
  title: string;
  /** The plan markdown itself — needed to seed a fresh session when the
   * original transcript is gone. */
  body: string;
  createdAt: string;
  /** What the transcript says, with no operator opinion folded in. */
  derived: Extract<PlanStatus, "proposed" | "in-progress" | "superseded">;
}

/** A plan as the client sees it: the adapter's reading, plus whatever the
 * operator has said about it and whether its session is still there. */
export interface PlanMeta extends AdapterPlan {
  /** `derived`, unless an operator override replaced it. */
  status: PlanStatus;
  /** False once the session's transcript has been deleted — implementing such
   * a plan starts a new session instead of resuming the old one. */
  sessionExists: boolean;
}
