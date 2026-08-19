import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@overseer/protocol";
import { normalizePermissionMode } from "./options.js";

export interface NormalizeContext {
  sessionId: string;
  timestamp: () => string;
}

/**
 * Map one NDJSON line from stream-json stdout to zero or more AgentEvents.
 *
 * The adapter always runs with `--include-partial-messages`, so every assistant
 * message crosses the wire twice: once as `content_block_delta` chunks and again
 * whole on the terminal `assistant` frame. We split the two sources rather than
 * read both — text comes from the deltas (it streams), tool calls come from the
 * `assistant` frame (`content_block_start` announces a tool_use with `input: {}`
 * and the arguments only arrive as `input_json_delta` chunks, so the start frame
 * cannot name what the tool is acting on).
 *
 * `parent_tool_use_id` sits at the top level of the envelope, not inside
 * `event` — subagent attribution depends on reading it from there.
 */
export function normalizeLine(
  line: string,
  ctx: NormalizeContext,
): AgentEvent[] {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (typeof record !== "object" || record === null) return [];

  const obj = record as Record<string, unknown>;
  const ts = ctx.timestamp();
  const sessionId = ctx.sessionId;
  const parent =
    typeof obj.parent_tool_use_id === "string"
      ? { parentToolUseId: obj.parent_tool_use_id }
      : {};

  if (obj.type === "system" && obj.subtype === "init") {
    return sessionInitFrom(obj, sessionId, ts);
  }

  if (obj.type === "init") {
    return sessionInitFrom(obj, sessionId, ts);
  }

  if (obj.type === "stream_event" && typeof obj.event === "object" && obj.event) {
    const event = obj.event as Record<string, unknown>;
    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return [
          {
            type: "text.delta",
            sessionId,
            timestamp: ts,
            text: delta.text,
            ...parent,
          },
        ];
      }
      if (
        delta?.type === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        return [
          {
            type: "thinking.delta",
            sessionId,
            timestamp: ts,
            text: delta.thinking,
            ...parent,
          },
        ];
      }
    }
    return [];
  }

  if (obj.type === "assistant") {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as { type?: string; id?: string; name?: string; input?: unknown };
      // Text is intentionally skipped: the deltas already carried it.
      if (b.type !== "tool_use") continue;
      events.push({
        type: "tool.start",
        sessionId,
        timestamp: ts,
        toolUseId: typeof b.id === "string" ? b.id : randomUUID(),
        name: typeof b.name === "string" ? b.name : "tool",
        input: b.input ?? {},
        ...parent,
      });
    }
    return events;
  }

  if (obj.type === "user" && obj.message) {
    // `--replay-user-messages` echoes our own input back, flagged `isReplay`.
    // Everything else arriving as a user frame is a tool result.
    if (obj.isReplay === true) return [];
    return toolResultsFrom(
      obj.message as Record<string, unknown>,
      sessionId,
      ts,
    );
  }

  if (obj.type === "control_request") {
    const request = obj.request as Record<string, unknown> | undefined;
    if (request?.subtype === "can_use_tool") {
      return [
        {
          type: "permission.request",
          sessionId,
          timestamp: ts,
          requestId:
            typeof obj.request_id === "string" ? obj.request_id : randomUUID(),
          toolName:
            typeof request.tool_name === "string" ? request.tool_name : "tool",
          input: request.input ?? {},
        },
      ];
    }
    return [];
  }

  if (obj.type === "result") {
    const usageObj =
      typeof obj.usage === "object" && obj.usage !== null
        ? (obj.usage as Record<string, unknown>)
        : {};
    return [
      {
        type: "turn.end",
        sessionId,
        timestamp: ts,
        usage: {
          inputTokens:
            typeof usageObj.input_tokens === "number"
              ? usageObj.input_tokens
              : 0,
          outputTokens:
            typeof usageObj.output_tokens === "number"
              ? usageObj.output_tokens
              : 0,
          ...(typeof usageObj.cache_read_input_tokens === "number"
            ? { cacheReadTokens: usageObj.cache_read_input_tokens }
            : {}),
          ...(typeof usageObj.cache_creation_input_tokens === "number"
            ? { cacheWriteTokens: usageObj.cache_creation_input_tokens }
            : {}),
        },
        totalCostUsd:
          typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : 0,
        durationMs:
          typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
        numTurns: typeof obj.num_turns === "number" ? obj.num_turns : 0,
      },
    ];
  }

  if (obj.type === "error") {
    return [
      {
        type: "error",
        sessionId,
        timestamp: ts,
        message:
          typeof obj.message === "string" ? obj.message : "stream error",
        recoverable: obj.is_error !== true,
      },
    ];
  }

  return [];
}

/** Tool results ride in on a user frame as `tool_result` content blocks. */
function toolResultsFrom(
  message: Record<string, unknown>,
  sessionId: string,
  ts: string,
): AgentEvent[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const events: AgentEvent[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as {
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type !== "tool_result") continue;
    if (typeof b.tool_use_id !== "string") continue;
    events.push({
      type: "tool.end",
      sessionId,
      timestamp: ts,
      toolUseId: b.tool_use_id,
      output: b.content ?? null,
      isError: b.is_error === true,
    });
  }
  return events;
}

function sessionInitFrom(
  obj: Record<string, unknown>,
  sessionId: string,
  ts: string,
): AgentEvent[] {
  const tools = Array.isArray(obj.tools)
    ? obj.tools.filter((t): t is string => typeof t === "string")
    : [];
  const mcpServers = Array.isArray(obj.mcp_servers)
    ? obj.mcp_servers.filter((t): t is string => typeof t === "string")
    : [];
  const slashCommands = Array.isArray(obj.slash_commands)
    ? obj.slash_commands.filter((t): t is string => typeof t === "string")
    : [];
  // Names only on this frame — the richer `{name, description}` shape comes from
  // the `initialize` control request (options.ts), not from here.
  const agents = Array.isArray(obj.agents)
    ? obj.agents.filter((t): t is string => typeof t === "string")
    : [];
  const permissionMode = normalizePermissionMode(obj.permissionMode);
  return [
    {
      type: "session.init",
      sessionId,
      timestamp: ts,
      model: typeof obj.model === "string" ? obj.model : "",
      cwd: typeof obj.cwd === "string" ? obj.cwd : "",
      tools,
      mcpServers,
      slashCommands,
      agents,
      ...(permissionMode !== undefined ? { permissionMode } : {}),
    },
  ];
}

export function exitEvent(
  sessionId: string,
  cause: "user" | "idle" | "crash" | "auth-failure",
  code: number | null,
): AgentEvent {
  return {
    type: "exit",
    sessionId,
    timestamp: new Date().toISOString(),
    cause,
    code,
  };
}
