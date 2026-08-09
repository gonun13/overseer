import type { AgentEvent } from "./events.js";

/** Flag set the UI renders controls from — an adapter that can't do X doesn't grow an X zone. */
export interface AdapterCapabilities {
  streamingDeltas: boolean;
  permissionPrompts: boolean;
  interrupt: boolean;
  subagents: boolean;
  mcp: boolean;
  skills: boolean;
  effortLevels: boolean;
  costReporting: boolean;
  checkpoints: boolean;
  backgroundAgents: boolean;
}

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type PermissionDecision =
  | { decision: "allow-once" }
  | { decision: "allow-always"; rule: string }
  | { decision: "deny"; feedback?: string };

export interface SessionOpts {
  projectDir: string;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  resumeSessionId?: string;
  name?: string;
}

export interface SessionMeta {
  id: string;
  adapterId: string;
  name?: string;
  projectDir: string;
  gitBranch?: string;
  model: string;
  permissionMode: PermissionMode;
  status: "live" | "dormant" | "closed";
  createdAt: string;
  lastActiveAt: string;
  totalCostUsd: number;
}

export interface UserMessage {
  role: "user";
  content: Array<{ type: "text"; text: string } | { type: "image"; source: string; mediaType: string }>;
}

export interface SessionHandle {
  events: AsyncIterable<AgentEvent>;
  /** Queues if a turn is in flight. */
  send(msg: UserMessage): void;
  interrupt(): void;
  resolvePermission(id: string, decision: PermissionDecision): void;
  close(): Promise<void>;
}

export interface AgentAdapter {
  id: string;
  capabilities: AdapterCapabilities;
  createSession(opts: SessionOpts): Promise<SessionHandle>;
  resumeSession(id: string): Promise<SessionHandle>;
  listSessions(): Promise<SessionMeta[]>;
}
