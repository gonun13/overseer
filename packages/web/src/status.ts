/** The one status vocabulary. Every light, row and signal in the app uses it —
 * a project, a session, a capability and a notification are all "an activity". */
export type Activity =
  | "idle"
  | "working"
  | "done"
  | "waiting"
  | "attention"
  | "approval";

/** Which activities pulse. Pulsing means "in motion or unresolved", steady means "settled". */
export const ACTIVITY_PULSES: Record<Activity, boolean> = {
  idle: false,
  working: true,
  done: false,
  waiting: true,
  attention: false,
  approval: true,
};

/** Sort order for the overseer space: what the operator should look at first.
 * `approval` outranks everything — a session sitting on a `can_use_tool`
 * request is not making progress until the operator answers it. */
export const ACTIVITY_RANK: Record<Activity, number> = {
  approval: 0,
  attention: 1,
  waiting: 2,
  working: 3,
  done: 4,
  idle: 5,
};

/** The headline word for the whole system, given the most urgent activity present. */
export const ACTIVITY_HEADLINE: Record<Activity, string> = {
  approval: "approval",
  attention: "attention",
  waiting: "blocked",
  working: "working",
  done: "ready",
  idle: "idle",
};

/** The bracketed word in the operations window's `label... [STATUS]` lines.
 * A second vocabulary would be a second status system — this is the same five
 * values wearing the register that log reads in (docs/overseer.md §3). An
 * operation step never actually reaches `approval` — kept only so the map
 * stays exhaustive. */
export const ACTIVITY_STEP_WORD: Record<Activity, string> = {
  approval: "blocked",
  attention: "failed",
  waiting: "blocked",
  working: "...",
  done: "ok",
  idle: "skipped",
};
