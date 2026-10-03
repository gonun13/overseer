import { randomUUID } from "node:crypto";
import type {
  AdapterSessionStore,
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  AdapterUsageCheck,
  ConsoleCommand,
  ConsoleOpts,
} from "@overseer/protocol";
import { consoleCommand } from "./console.js";
import { readAuthStatus, signOut, startLogin } from "./login.js";
import {
  deleteSession,
  listProjectSessions,
  lookupSessionTitle,
  sessionsWatchPath,
} from "./transcripts.js";
import { checkUsage as runUsageCheck } from "./usage.js";

/**
 * `usageCheck: true` — no `refreshUsage` (see `getStatus` below), but
 * `checkUsage` (`usage.ts`) is real: the account's period is read straight
 * from the dashboard service with the CLI's own stored token, and only if
 * that fails does it fall back to a real CLI turn (~160s, ~100k tokens for
 * one ask). Manual and unscheduled because of that fallback.
 */
const capabilities: AdapterCapabilities = {
  login: true,
  usageCheck: true,
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  capabilities,
  async getStatus(): Promise<AdapterStatus> {
    const status = await readAuthStatus();
    // No refreshUsage exists below — cursor exposes no subscription-window
    // reading this adapter could ask for (unlike claude's `/usage`).
    // Stamp `unavailable` up front, signed in or not, rather than leaving
    // `usageState` undefined: the widget's fallback reads an absent state on
    // an authenticated status as "pending" and shows a countdown for a
    // refresh that will never run.
    return status.authenticated
      ? { ...status, usageState: "unavailable" }
      : status;
  },
  // No refreshUsage: see the `usageState: "unavailable"` stamp in getStatus
  // above — there is nothing for a refresh to move it on to.
  checkUsage(opts: { projectDir: string }): Promise<AdapterUsageCheck> {
    return runUsageCheck(opts);
  },
  login: {
    start: startLogin,
    signOut,
  },
  consoleCommand(opts: ConsoleOpts): Promise<ConsoleCommand> {
    return consoleCommand(opts);
  },
  sessionsWatchPath(): string {
    return sessionsWatchPath();
  },
  sessions: {
    listProjectSessions,
    // `agent --resume` adopts an id it has never seen, so a local mint is all
    // a new chat needs.
    async mintSessionId(): Promise<string> {
      return randomUUID();
    },
    lookupSessionTitle,
    deleteSession,
  } satisfies AdapterSessionStore,
};

export default cursorAdapter;

export { listProjectSessions, lookupSessionTitle, deleteSession } from "./transcripts.js";
