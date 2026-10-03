import type { ConsoleActivity, ConsoleInfo } from "@overseer/protocol";
import type { Activity } from "../status.ts";

/** How a console's activity reads on a status light. `waiting` is the CLI
 * asking the operator something — the same urgency an approval always had. */
export function consoleLight(info: ConsoleInfo): Activity {
  if (info.status === "exited") return exitedBadly(info) ? "attention" : "done";
  return ACTIVITY_LIGHT[info.activity];
}

const ACTIVITY_LIGHT: Record<ConsoleActivity, Activity> = {
  working: "working",
  waiting: "approval",
  idle: "idle",
  unknown: "idle",
};

/** Shell convention for "ended by signal N": exit code 128 + N. A pty often
 * reports the code and no signal, so these are read as the signal they mean —
 * hangup, interrupt, kill, terminate. */
const SIGNAL_EXIT_CODES = new Set([129, 130, 137, 143]);

/** Exited with an error of its own, as opposed to finishing (0) or being
 * ended by a signal — a kill, from here or from anywhere else, is not a
 * failure to report. */
export function exitedBadly(info: ConsoleInfo): boolean {
  if (info.status !== "exited") return false;
  if (info.exitCode === 0 || info.signal !== undefined) return false;
  return info.exitCode === undefined || !SIGNAL_EXIT_CODES.has(info.exitCode);
}
