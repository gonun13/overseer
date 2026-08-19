import type { PermissionMode } from "./adapter.js";

/** Normalized event union emitted by every adapter over `SessionHandle.events`. */
export type AgentEvent =
  | SessionInitEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolStartEvent
  | ToolDeltaEvent
  | ToolEndEvent
  | PermissionRequestEvent
  | TodoUpdateEvent
  | SubagentStartEvent
  | SubagentTextEvent
  | SubagentEndEvent
  | TurnEndEvent
  | ErrorEvent
  | ExitEvent;

interface BaseEvent {
  sessionId: string;
  timestamp: string;
}

export interface SessionInitEvent extends BaseEvent {
  type: "session.init";
  model: string;
  cwd: string;
  tools: string[];
  mcpServers: string[];
  slashCommands: string[];
  /** What the process actually started under — not what we asked for. Absent
   * when the provider did not say. */
  permissionMode?: PermissionMode;
  /** Subagents this session can call, as the provider named them. */
  agents: string[];
}

export interface TextDeltaEvent extends BaseEvent {
  type: "text.delta";
  text: string;
  parentToolUseId?: string;
}

export interface ThinkingDeltaEvent extends BaseEvent {
  type: "thinking.delta";
  text: string;
  parentToolUseId?: string;
}

export interface ToolStartEvent extends BaseEvent {
  type: "tool.start";
  toolUseId: string;
  name: string;
  input: unknown;
  parentToolUseId?: string;
}

export interface ToolDeltaEvent extends BaseEvent {
  type: "tool.delta";
  toolUseId: string;
  chunk: string;
}

export interface ToolEndEvent extends BaseEvent {
  type: "tool.end";
  toolUseId: string;
  output: unknown;
  isError: boolean;
}

export interface PermissionRequestEvent extends BaseEvent {
  type: "permission.request";
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface TodoUpdateEvent extends BaseEvent {
  type: "todo.update";
  items: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

export interface SubagentStartEvent extends BaseEvent {
  type: "subagent.start";
  parentToolUseId: string;
  name: string;
}

export interface SubagentTextEvent extends BaseEvent {
  type: "subagent.text";
  parentToolUseId: string;
  text: string;
}

export interface SubagentEndEvent extends BaseEvent {
  type: "subagent.end";
  parentToolUseId: string;
}

export interface TurnEndEvent extends BaseEvent {
  type: "turn.end";
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
}

export interface ErrorEvent extends BaseEvent {
  type: "error";
  message: string;
  recoverable: boolean;
}

export interface ExitEvent extends BaseEvent {
  type: "exit";
  cause: "user" | "idle" | "crash" | "auth-failure";
  code: number | null;
}
