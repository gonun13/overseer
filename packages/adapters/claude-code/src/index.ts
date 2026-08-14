import type {
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";
import { readAuthStatus, signOut, startLogin } from "./login.js";

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
 * The second question is put to the CLI (`claude auth status`) rather than
 * inferred from a `.credentials.json` on disk. A file-presence test could not
 * tell a live token from an expired one and had to say so in its own `detail`;
 * this can, so it does.
 *
 * Never throws — a failed check is a status, not an error.
 */
async function getStatus(): Promise<AdapterStatus> {
  return readAuthStatus();
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
  login: {
    start: startLogin,
    signOut,
  },
};

export default claudeCodeAdapter;
