import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";

const run = promisify(execFile);

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
};

// Process spawning (design doc §1.2 — one long-lived `claude` process per session,
// stream-json in/out) lands with the console feature. Stubbed so the server and
// frontend can be wired against the real interface shape from day one.
function notImplemented(): never {
  throw new Error(
    "adapter-claude-code: session spawning is not implemented yet",
  );
}

/**
 * Two independent facts, checked separately because they fail separately: is
 * the CLI here at all, and has anyone signed it in.
 *
 * The login check is the presence of `.credentials.json` under
 * `CLAUDE_CONFIG_DIR` — where the CLI writes its OAuth token. It is a file
 * test, not a token validation: this cannot tell a live token from an expired
 * one, so it never claims to. `detail` says what was actually checked rather
 * than implying more, and the PTY `setup-token` flow (design doc §2) will
 * replace this with a real answer when it lands.
 *
 * Never throws — a failed check is a status, not an error.
 */
async function getStatus(): Promise<AdapterStatus> {
  let version: string | undefined;
  try {
    const { stdout } = await run("claude", ["--version"], { timeout: 5_000 });
    // "2.1.226 (Claude Code)" — take the version, drop the parenthetical.
    version = stdout.trim().split(/\s+/)[0];
  } catch {
    return {
      authenticated: false,
      detail: "claude CLI not found on PATH",
    };
  }

  const configDir = process.env.CLAUDE_CONFIG_DIR ?? "/home/node/.claude";
  try {
    await access(path.join(configDir, ".credentials.json"));
  } catch {
    return {
      authenticated: false,
      version,
      detail: `not logged in · no credentials in ${configDir}`,
    };
  }

  return {
    authenticated: true,
    version,
    detail: "credentials present (not validated against the API)",
  };
}

export const claudeCodeAdapter: AgentAdapter = {
  id: "claude-code",
  capabilities,
  async createSession(_opts: SessionOpts): Promise<SessionHandle> {
    notImplemented();
  },
  async resumeSession(_id: string): Promise<SessionHandle> {
    notImplemented();
  },
  async listSessions(): Promise<SessionMeta[]> {
    return [];
  },
  getStatus,
};

export default claudeCodeAdapter;
