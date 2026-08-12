/** The one status vocabulary. Every light, row and signal in the app uses it —
 * a project, a session, a capability and a notification are all "an activity". */
export type Activity = "idle" | "working" | "done" | "waiting" | "attention";

/** Which activities pulse. Pulsing means "in motion or unresolved", steady means "settled". */
export const ACTIVITY_PULSES: Record<Activity, boolean> = {
  idle: false,
  working: true,
  done: false,
  waiting: false,
  attention: true,
};

/** Sort order for the overseer space: what the operator should look at first. */
export const ACTIVITY_RANK: Record<Activity, number> = {
  attention: 0,
  waiting: 1,
  working: 2,
  done: 3,
  idle: 4,
};

/** The headline word for the whole system, given the most urgent activity present. */
export const ACTIVITY_HEADLINE: Record<Activity, string> = {
  attention: "attention",
  waiting: "blocked",
  working: "working",
  done: "ready",
  idle: "idle",
};

/** The bracketed word in the operations window's `label... [STATUS]` lines.
 * A second vocabulary would be a second status system — this is the same five
 * values wearing the register that log reads in (docs/overseer.md §3). */
export const ACTIVITY_STEP_WORD: Record<Activity, string> = {
  attention: "failed",
  waiting: "blocked",
  working: "...",
  done: "ok",
  idle: "skipped",
};
