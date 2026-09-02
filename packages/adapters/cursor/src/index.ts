import type {
  AdapterSessionStore,
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  AdapterUsageCheck,
  ConsoleHandle,
  ConsoleOpts,
  ProviderOptions,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";
import { openConsole } from "./console.js";
import { readAuthStatus, signOut, startLogin } from "./login.js";
import { readProviderOptions } from "./options.js";
import { createSessionHandle, mintSessionId, openSession } from "./session-handle.js";
import {
  deleteSession,
  findProjectDirForSession,
  listProjectSessions,
  lookupSessionTitle,
  readSessionHistory,
  sessionsWatchPath,
} from "./transcripts.js";
import { checkUsage as runUsageCheck } from "./usage.js";

/**
 * Cursor's own capabilities, honestly scoped to what this adapter actually
 * does rather than what the CLI is theoretically capable of:
 *
 * - `permissionPrompts: false` — no interactive approval loop exists under
 *   `--print` (verified: an untrusted cwd just hard-fails asking for
 *   `--trust`/`--force`, there is no per-tool-call prompt to answer). This
 *   adapter always spawns with `--trust --force`.
 * - `subagents: false` — cursor's CLI can genuinely spawn subagents
 *   (`.cursor/agents/*.md`, verified in the shipped bundle), but this
 *   adapter's `normalize.ts` does not distinguish a subagent's `tool_call`
 *   from an ordinary one, so setting this true would grow a UI zone that
 *   never populates.
 * - `mcp` / `skills` / `effortLevels` — nothing here enumerates or reports
 *   any of the three; `session.init` carries no equivalent field and no
 *   `--effort` flag exists (effort is baked into a model's own id string).
 * - `costReporting: false` — `result`'s `usage` is token counts only, no
 *   dollar figure; reporting a permanent `$0.00` would be a false zero, not
 *   an honest "unavailable".
 * - `usageCheck: true` — no `refreshUsage` (see `getStatus` below), but
 *   `checkUsage` (`usage.ts`) is real: `/usage` is not a client-intercepted
 *   command here, it is a plain prompt the model answers with a real turn —
 *   verified live, ~46s and ~37k tokens for one ask. Manual and unscheduled
 *   for exactly that reason.
 */
const capabilities: AdapterCapabilities = {
  streamingDeltas: true,
  permissionPrompts: false,
  interrupt: true,
  subagents: false,
  mcp: false,
  skills: false,
  effortLevels: false,
  costReporting: false,
  checkpoints: false,
  backgroundAgents: false,
  login: true,
  usageCheck: true,
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  capabilities,
  async createSession(opts: SessionOpts): Promise<SessionHandle> {
    const chatId = await mintSessionId();
    return openSession(chatId, opts);
  },
  async resumeSession(id: string): Promise<SessionHandle> {
    const projectDir = await findProjectDirForSession(id);
    return createSessionHandle(id, { projectDir, resumeSessionId: id });
  },
  async listSessions(): Promise<SessionMeta[]> {
    // Supervisor filters by active project; adapter exposes scan helper only.
    return [];
  },
  async getStatus(): Promise<AdapterStatus> {
    const status = await readAuthStatus();
    // No refreshUsage exists below — cursor exposes no subscription-window
    // reading this adapter could ask for (unlike claude-code's `/usage`).
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
  listOptions(opts: { projectDir: string }): Promise<ProviderOptions> {
    return readProviderOptions(opts);
  },
  login: {
    start: startLogin,
    signOut,
  },
  openConsole(opts: ConsoleOpts): Promise<ConsoleHandle> {
    return openConsole(opts);
  },
  sessionsWatchPath(): string {
    return sessionsWatchPath();
  },
  sessions: {
    listProjectSessions,
    readSessionHistory,
    openSession: async (id, opts) => openSession(id, opts),
    mintSessionId,
    lookupSessionTitle,
    deleteSession,
  } satisfies AdapterSessionStore,
};

export default cursorAdapter;

export { mintSessionId, openSession } from "./session-handle.js";
export { listProjectSessions, readSessionHistory, lookupSessionTitle, deleteSession } from "./transcripts.js";
