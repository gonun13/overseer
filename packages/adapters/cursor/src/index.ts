import type {
  AdapterSessionStore,
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  AdapterUsageCheck,
  ConsoleHandle,
  ConsoleOpts,
  ProviderOptions,
  Skill,
  SkillImportOutcome,
  SkillScope,
  Subagent,
  SubagentDraft,
  SubagentScope,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";
import { openConsole } from "./console.js";
import { readSubagents } from "./custom-agents.js";
import { readAuthStatus, signOut, startLogin } from "./login.js";
import { readProviderOptions } from "./options.js";
import { listProjectPlans } from "./plans.js";
import { createSessionHandle, mintSessionId, openSession } from "./session-handle.js";
import { deleteSkillDir, importSkillDir } from "./skill-files.js";
import { readSkills } from "./skills.js";
import { deleteSubagentFile, writeSubagentFile } from "./subagent-files.js";
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
 * - `subagents: true` — the operator's `.cursor/agents/*.md` files are read
 *   and written here (`custom-agents.ts`, `subagent-files.ts`), against the
 *   one folder the CLI itself resolves. Note what this flag does *not* claim:
 *   `normalize.ts` still cannot tell a subagent's `tool_call` from an ordinary
 *   one, so no `subagent.start`/`.text`/`.end` events are emitted. The
 *   capability is the editor, not the live reporting.
 * - `mcp` / `skills` / `effortLevels` — nothing here enumerates or reports
 *   any of the three; `session.init` carries no equivalent field and no
 *   `--effort` flag exists (effort is baked into a model's own id string).
 * - `costReporting: false` — `result`'s `usage` is token counts only, no
 *   dollar figure; reporting a permanent `$0.00` would be a false zero, not
 *   an honest "unavailable".
 * - `usageCheck: true` — no `refreshUsage` (see `getStatus` below), but
 *   `checkUsage` (`usage.ts`) is real: the account's period is read straight
 *   from the dashboard service with the CLI's own stored token, and only if
 *   that fails does it fall back to a real CLI turn (~160s, ~100k tokens for
 *   one ask). Manual and unscheduled because of that fallback.
 */
const capabilities: AdapterCapabilities = {
  streamingDeltas: true,
  permissionPrompts: false,
  interrupt: true,
  subagents: true,
  mcp: false,
  skills: true,
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
  async listSubagents(opts: { projectDir: string }): Promise<Subagent[]> {
    // Never throws, per the interface: an unreadable folder is reported as no
    // agents, the same way `readSubagents` treats a missing one.
    try {
      return await readSubagents(opts);
    } catch {
      return [];
    }
  },
  writeSubagent(opts: {
    projectDir: string;
    draft: SubagentDraft;
    previous?: { name: string; scope: SubagentScope };
  }): Promise<Subagent> {
    return writeSubagentFile(opts);
  },
  deleteSubagent(opts: {
    projectDir: string;
    name: string;
    scope: SubagentScope;
  }): Promise<void> {
    return deleteSubagentFile(opts);
  },
  async listSkills(opts: { projectDir: string }): Promise<Skill[]> {
    // Never throws, per the interface.
    try {
      return await readSkills(opts);
    } catch {
      return [];
    }
  },
  importSkills(opts: {
    projectDir: string;
    stagingDir: string;
    scope: SkillScope;
    name?: string;
  }): Promise<SkillImportOutcome> {
    return importSkillDir(opts);
  },
  deleteSkill(opts: {
    projectDir: string;
    name: string;
    scope: SkillScope;
  }): Promise<void> {
    return deleteSkillDir(opts);
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
    listProjectPlans,
  } satisfies AdapterSessionStore,
};

export default cursorAdapter;

export { mintSessionId, openSession } from "./session-handle.js";
export { listProjectSessions, readSessionHistory, lookupSessionTitle, deleteSession } from "./transcripts.js";
