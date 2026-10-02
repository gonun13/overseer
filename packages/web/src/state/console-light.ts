import type { ConsoleActivity, ConsoleInfo } from "@overseer/protocol";
import type { Activity } from "../status.ts";

/** How a console's activity reads on a status light. `waiting` is the CLI
 * asking the operator something — the same urgency an approval always had. */
export function consoleLight(info: ConsoleInfo): Activity {
  if (info.status === "exited") {
    return info.exitCode === 0 || info.signal !== undefined ? "done" : "attention";
  }
  return ACTIVITY_LIGHT[info.activity];
}

const ACTIVITY_LIGHT: Record<ConsoleActivity, Activity> = {
  working: "working",
  waiting: "approval",
  idle: "idle",
  unknown: "idle",
};
