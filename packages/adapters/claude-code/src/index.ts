import type {
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  ConsoleHandle,
  ConsoleOpts,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";
import { openConsole } from "./console.js";
import {
  backfillHistory,
  deleteSessionTranscript,
  listSessionsForProject,
} from "./jsonl.js";
import { readAuthStatus, signOut, startLogin } from "./login.js";
import { createSessionHandle, mintSessionId, openSession } from "./session-handle.js";
import { resolveSessionTitle } from "./session-titles.js";
import { readUsageWindows, withPendingUsage } from "./usage.js";

const capabilities: AdapterCapabilities = {
  streamingDeltas: true,
  permissionPrompts: true,
  interrupt: true,
  subagents: true,
  mcp: true,
  skills: true,
  effortLevels: true,
  costReporting: true,
  checkpoints: false,
  backgroundAgents: false,
  login: true,
};

function configDir(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR ??
    `${process.env.HOME ?? "/home/node"}/.claude`
  );
}

async function getStatus(): Promise<AdapterStatus> {
  return withPendingUsage(await readAuthStatus());
}

async function refreshUsage(): Promise<AdapterStatus> {
  const usage = await readUsageWindows();
  if (usage.length === 0) {
    return { authenticated: true, usageState: "unavailable" };
  }
  return { authenticated: true, usage, usageState: "ready" };
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  capabilities,
  async createSession(opts: SessionOpts): Promise<SessionHandle> {
    return openSession(mintSessionId(), opts);
  },
  async resumeSession(id: string): Promise<SessionHandle> {
    const projectDir = await findProjectDirForSession(id);
    return createSessionHandle(id, {
      projectDir,
      resumeSessionId: id,
    });
  },
  async listSessions(): Promise<SessionMeta[]> {
    // Supervisor filters by active project; adapter exposes scan helper only.
    return [];
  },
  getStatus,
  refreshUsage,
  login: {
    start: startLogin,
    signOut,
  },
  openConsole(opts: ConsoleOpts): Promise<ConsoleHandle> {
    return openConsole(opts);
  },
};

async function findProjectDirForSession(sessionId: string): Promise<string> {
  const { readdir, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.join(configDir(), "projects");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    throw new Error(`session not found: ${sessionId}`);
  }
  for (const slug of entries) {
    const file = path.join(root, slug, `${sessionId}.jsonl`);
    try {
      const raw = await readFile(file, "utf8");
      // `cwd` is not on the opening record — a transcript starts with
      // bookkeeping (`mode`, `queue-operation`) that carries no path, so scan
      // forward for the first record that states one.
      for (const line of raw.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        let record: { cwd?: unknown };
        try {
          record = JSON.parse(line) as { cwd?: unknown };
        } catch {
          continue;
        }
        if (typeof record.cwd === "string" && record.cwd !== "") {
          return record.cwd;
        }
      }
    } catch {
      // not in this slug
    }
  }
  throw new Error(`session not found: ${sessionId}`);
}

/** List sessions for one project directory — used by the session supervisor. */
export async function listProjectSessions(
  projectDir: string,
): Promise<SessionMeta[]> {
  return listSessionsForProject(configDir(), projectDir);
}

/** Backfill transcript turns from JSONL — used by the session supervisor. */
export async function readSessionHistory(
  projectDir: string,
  sessionId: string,
) {
  return backfillHistory(configDir(), projectDir, sessionId);
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

export { mintSessionId, openSession } from "./session-handle.js";
