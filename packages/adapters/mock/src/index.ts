import type {
  AgentAdapter,
  AdapterCapabilities,
  AdapterStatus,
  AgentEvent,
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

// TODO: replay recorded NDJSON fixtures from packages/adapters/mock/fixtures/*.jsonl
// instead of the empty stream below, once fixtures exist.
async function* noEvents(): AsyncGenerator<AgentEvent> {}

function createHandle(): SessionHandle {
  return {
    events: noEvents(),
    send() {},
    interrupt() {},
    resolvePermission() {},
    async close() {},
  };
}

export const mockAdapter: AgentAdapter = {
  id: "mock",
  capabilities,
  async createSession(_opts: SessionOpts) {
    return createHandle();
  },
  async resumeSession(_id: string) {
    return createHandle();
  },
  async listSessions(): Promise<SessionMeta[]> {
    return [];
  },
  /** Always authenticated, and that is not a placeholder: this adapter replays
   * fixtures, so there is no account to sign into and nothing that could ever
   * fail to be signed in. */
  async getStatus(): Promise<AdapterStatus> {
    return { authenticated: true, detail: "replays fixtures; no auth needed" };
  },
};

export default mockAdapter;
