import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@overseer/protocol";

/**
 * Map one NDJSON line from `agent --print --output-format stream-json
 * --stream-partial-output` stdout to zero or more AgentEvents.
 *
 * Shapes below were captured against the real CLI (`agent
 * 2026.08.31-4057e58`), not published — a version bump can change any of
 * them, and this returns `[]` on anything unrecognized rather than guessing.
 *
 * Text streaming: an `assistant` frame that carries `timestamp_ms` is a true
 * incremental delta (verified: prompting "count to twenty" produced one
 * `assistant` frame per token/newline, each with a fresh `timestamp_ms`, the
 * text in each never repeating the last). The *final* `assistant` frame for a
 * turn — and the `result` frame's own `.result` — carries the *whole*
 * response again, with no `timestamp_ms`. Both must be skipped once any
 * delta has streamed, or every reply doubles; this is `needsTextFallback`,
 * the same shape as claude-code's `normalize.ts` for the same reason (a
 * failure that skips streaming and lands text only on the final frame).
 *
 * The CLI also writes non-JSON lines to stdout (`cursor-retrieval: tracing
 * to …`) — unparseable lines return `[]`, same as an unrecognized `type`.
 */

/** Mutable per-session turn flags shared across `normalizeLine` calls. */
export interface NormalizeTurnState {
  /** True once any `text.delta` has been emitted for the open turn. */
  emittedText: boolean;
}

export interface NormalizeContext {
  sessionId: string;
  timestamp: () => string;
  turn?: NormalizeTurnState;
}

function noteEmittedText(ctx: NormalizeContext): void {
  if (ctx.turn) ctx.turn.emittedText = true;
}

function needsTextFallback(ctx: NormalizeContext): boolean {
  return ctx.turn !== undefined && !ctx.turn.emittedText;
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("");
}

/** The one inner key of a `tool_call` frame's `tool_call` object — its name
 * ends in `ToolCall` (`readToolCall`, `shellToolCall`, …); this strips that
 * suffix for the event's `name`. Absent when the shape doesn't match, which
 * this treats as "nothing to report" rather than a guess. */
function toolCallEntry(
  toolCall: unknown,
): { toolName: string; body: Record<string, unknown> } | undefined {
  if (typeof toolCall !== "object" || toolCall === null) return undefined;
  for (const [key, value] of Object.entries(toolCall as Record<string, unknown>)) {
    if (!key.endsWith("ToolCall")) continue;
    if (typeof value !== "object" || value === null) continue;
    return { toolName: key.slice(0, -"ToolCall".length), body: value as Record<string, unknown> };
  }
  return undefined;
}

export function normalizeLine(line: string, ctx: NormalizeContext): AgentEvent[] {
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

  if (obj.type === "system" && obj.subtype === "init") {
    return [
      {
        type: "session.init",
        sessionId,
        timestamp: ts,
        model: typeof obj.model === "string" ? obj.model : "",
        cwd: typeof obj.cwd === "string" ? obj.cwd : "",
        // Not reported on this frame — cursor has no tool/MCP/slash-command
        // enumeration equivalent to claude's `initialize` control request.
        tools: [],
        mcpServers: [],
        slashCommands: [],
        agents: [],
      },
    ];
  }

  if (obj.type === "thinking") {
    if (obj.subtype === "delta" && typeof obj.text === "string") {
      return [{ type: "thinking.delta", sessionId, timestamp: ts, text: obj.text }];
    }
    return [];
  }

  if (obj.type === "assistant") {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    const isDelta = typeof obj.timestamp_ms === "number";
    const text = textFromContent(content);
    if (text === "") return [];
    if (isDelta) {
      noteEmittedText(ctx);
      return [{ type: "text.delta", sessionId, timestamp: ts, text }];
    }
    // The final, whole-turn frame — only relevant when nothing streamed.
    if (needsTextFallback(ctx)) {
      noteEmittedText(ctx);
      return [{ type: "text.delta", sessionId, timestamp: ts, text }];
    }
    return [];
  }

  if (obj.type === "tool_call") {
    const entry = toolCallEntry(obj.tool_call);
    if (entry === undefined) return [];
    const toolUseId = typeof obj.call_id === "string" ? obj.call_id : randomUUID();
    if (obj.subtype === "started") {
      return [
        {
          type: "tool.start",
          sessionId,
          timestamp: ts,
          toolUseId,
          name: entry.toolName,
          input: entry.body.args ?? {},
        },
      ];
    }
    if (obj.subtype === "completed") {
      const result = entry.body.result;
      const isError =
        typeof result === "object" && result !== null && "error" in (result as object);
      return [
        {
          type: "tool.end",
          sessionId,
          timestamp: ts,
          toolUseId,
          output: result ?? null,
          isError,
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
    const events: AgentEvent[] = [];
    const errorDetail =
      obj.is_error === true
        ? typeof obj.result === "string" && obj.result.trim() !== ""
          ? obj.result
          : "request failed"
        : undefined;
    if (errorDetail !== undefined && needsTextFallback(ctx)) {
      noteEmittedText(ctx);
      events.push({ type: "text.delta", sessionId, timestamp: ts, text: errorDetail });
    }
    events.push({
      type: "turn.end",
      sessionId,
      timestamp: ts,
      usage: {
        inputTokens: typeof usageObj.inputTokens === "number" ? usageObj.inputTokens : 0,
        outputTokens: typeof usageObj.outputTokens === "number" ? usageObj.outputTokens : 0,
        ...(typeof usageObj.cacheReadTokens === "number"
          ? { cacheReadTokens: usageObj.cacheReadTokens }
          : {}),
        ...(typeof usageObj.cacheWriteTokens === "number"
          ? { cacheWriteTokens: usageObj.cacheWriteTokens }
          : {}),
      },
      // Cursor's `result` carries no cost figure — omitted from `usage`,
      // this is the totalCostUsd the protocol still requires a number for.
      totalCostUsd: 0,
      durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
      numTurns: 1,
    });
    if (errorDetail !== undefined) {
      events.push({ type: "error", sessionId, timestamp: ts, message: errorDetail, recoverable: true });
    }
    if (ctx.turn) ctx.turn.emittedText = false;
    return events;
  }

  return [];
}

export function exitEvent(
  sessionId: string,
  cause: "user" | "idle" | "crash" | "auth-failure",
  code: number | null,
): AgentEvent {
  return { type: "exit", sessionId, timestamp: new Date().toISOString(), cause, code };
}
