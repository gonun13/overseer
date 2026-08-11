import type {
  AgentAdapter,
  AdapterCapabilities,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";

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
};

export default claudeCodeAdapter;
