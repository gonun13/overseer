import type {
  AgentAdapter,
  AdapterCapabilities,
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
};

export default mockAdapter;
