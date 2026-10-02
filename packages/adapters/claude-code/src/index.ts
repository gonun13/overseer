import { randomUUID } from "node:crypto";
import { join as pathJoin } from "node:path";
import type {
  AdapterSessionStore,
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  ConsoleCommand,
  ConsoleOpts,
  SessionMeta,
} from "@overseer/protocol";
import { configDir } from "./config-dir.js";
import { consoleCommand } from "./console.js";
import { deleteSessionTranscript, listSessionsForProject } from "./jsonl.js";
import { readAuthStatus, signOut, startLogin } from "./login.js";
import { resolveSessionTitle } from "./session-titles.js";
import { readUsageWindows, withPendingUsage } from "./usage.js";

const capabilities: AdapterCapabilities = {
  login: true,
  // No checkUsage: refreshUsage already covers this adapter's usage surface
  // with a free, deterministic report — a second, manual path is redundant.
  usageCheck: false,
};

async function getStatus(): Promise<AdapterStatus> {
  return withPendingUsage(await readAuthStatus());
}

/**
 * Windows only, plus the one question an empty report cannot answer on its own.
 *
 * A report that came back with gauges proves the CLI is signed in, so the happy
 * path costs nothing extra. An *empty* one has two very different causes — a
 * parse miss on a signed-in CLI, or a session that is gone — and asserting
 * `authenticated: true` for both is what left the widget saying "signed in ·
 * usage currently not available" while the console refused with "provider is
 * not signed in". So the empty path re-asks `claude auth status`, which is the
 * same cheap check `getStatus` uses, and reports what it actually finds.
 */
async function refreshUsage(): Promise<AdapterStatus> {
  const usage = await readUsageWindows();
  if (usage.length === 0) {
    const status = await readAuthStatus();
    if (!status.authenticated) return status;
    return { ...status, usageState: "unavailable" };
  }
  return { authenticated: true, usage, usageState: "ready" };
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  capabilities,
  getStatus,
  refreshUsage,
  login: {
    start: startLogin,
    signOut,
  },
  consoleCommand(opts: ConsoleOpts): Promise<ConsoleCommand> {
    return consoleCommand(opts);
  },
  sessionsWatchPath(): string {
    // One directory above the per-project slugs, so a project the CLI has not
    // written to before is still covered — the slug directory itself only
    // appears with the first session in it.
    return pathJoin(configDir(), "projects");
  },
  sessions: {
    listProjectSessions,
    // Wrapped async — the interface leaves room for a provider whose id must
    // round-trip its own CLI; claude takes any id via `--session-id`.
    async mintSessionId(): Promise<string> {
      return randomUUID();
    },
    lookupSessionTitle,
    deleteSession,
  } satisfies AdapterSessionStore,
};

/** List sessions for one project directory — used by the session index. */
export async function listProjectSessions(
  projectDir: string,
): Promise<SessionMeta[]> {
  return listSessionsForProject(configDir(), projectDir);
}

/** Resolve Claude's display title for a session. */
export async function lookupSessionTitle(
  projectDir: string,
  sessionId: string,
): Promise<string | undefined> {
  return resolveSessionTitle(configDir(), projectDir, sessionId);
}

/** Permanently remove a session's transcript from disk. */
export async function deleteSession(
  projectDir: string,
  sessionId: string,
): Promise<void> {
  return deleteSessionTranscript(configDir(), projectDir, sessionId);
}

export default claudeCodeAdapter;
