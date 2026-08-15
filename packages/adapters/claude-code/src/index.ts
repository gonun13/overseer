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
import { readAuthStatus, signOut, startLogin } from "./login.js";
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

// Process spawning for stream-json agent sessions (design doc §1.2) is still
// stubbed. The raw PTY console (`openConsole`) is the interactive CLI escape
// hatch and is implemented separately.
function notImplemented(): never {
  throw new Error(
    "adapter-claude-code: session spawning is not implemented yet",
  );
}

/**
 * Three independent facts, checked separately because they fail separately: is
 * the CLI here at all, has anyone signed it in, and — only then — what the
 * subscription windows read.
 *
 * Auth is put to the CLI (`claude auth status`) rather than inferred from a
 * `.credentials.json` on disk. Usage is the CLI's own `/usage` report, asked
 * on `refreshUsage` so a hung Anthropic usage endpoint cannot stall discovery
 * or a login close. `getStatus` returns `usageState: "pending"` when signed in.
 *
 * `refreshUsage` does **not** re-run `auth status` — that call can hang on the
 * same outage, and the server already knows the operator is signed in when it
 * schedules the refresh. Never throws — a failed check is a status, not an error.
 */
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
  refreshUsage,
  login: {
    start: startLogin,
    signOut,
  },
  openConsole(opts: ConsoleOpts): Promise<ConsoleHandle> {
    return openConsole(opts);
  },
};

export default claudeCodeAdapter;
