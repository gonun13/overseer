import type {
  AdapterCapabilities,
  AgentAdapter,
  SessionHandle,
  SessionMeta,
  SessionOpts,
} from "@overseer/protocol";

const stubCapabilities: AdapterCapabilities = {
  streamingDeltas: false,
  permissionPrompts: false,
  interrupt: false,
  subagents: false,
  mcp: false,
  skills: false,
  effortLevels: false,
  costReporting: false,
  checkpoints: false,
  backgroundAgents: false,
  login: false,
};

/** Catalog-only adapters: CLI is in the image; sessions/auth/console are not wired yet. */
function stubAdapter(id: string): AgentAdapter {
  return {
    id,
    capabilities: stubCapabilities,
    async createSession(_opts: SessionOpts): Promise<SessionHandle> {
      throw new Error(`${id}: not implemented`);
    },
    async resumeSession(_id: string): Promise<SessionHandle> {
      throw new Error(`${id}: not implemented`);
    },
    async listSessions(): Promise<SessionMeta[]> {
      return [];
    },
    async getStatus() {
      return { authenticated: false, detail: "not implemented" };
    },
  };
}

export const stubAdapters: AgentAdapter[] = [
  stubAdapter("codex"),
  stubAdapter("opencode"),
  stubAdapter("github-copilot"),
];
