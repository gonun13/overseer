import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeLine, type NormalizeTurnState } from "../src/normalize.js";

function ctx(turn?: NormalizeTurnState) {
  return { sessionId: "s1", timestamp: () => "2026-01-01T00:00:00.000Z", turn };
}

describe("normalizeLine over real captured frames", () => {
  it("reports session.init from a system/init frame", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      apiKeySource: "login",
      cwd: "/tmp/curtest",
      session_id: "f75e2801-56bc-4577-bfa5-44268f5ced05",
      model: "Composer 2.5",
      permissionMode: "default",
    });
    const [event] = normalizeLine(line, ctx());
    assert.equal(event?.type, "session.init");
    if (event?.type === "session.init") {
      assert.equal(event.model, "Composer 2.5");
      assert.equal(event.cwd, "/tmp/curtest");
    }
  });

  it("streams thinking deltas and drops the completed marker", () => {
    const delta = JSON.stringify({
      type: "thinking",
      subtype: "delta",
      text: "The response will be",
      session_id: "s1",
      timestamp_ms: 1,
    });
    const completed = JSON.stringify({
      type: "thinking",
      subtype: "completed",
      session_id: "s1",
      timestamp_ms: 2,
    });
    assert.deepEqual(normalizeLine(delta, ctx()), [
      { type: "thinking.delta", sessionId: "s1", timestamp: "2026-01-01T00:00:00.000Z", text: "The response will be" },
    ]);
    assert.deepEqual(normalizeLine(completed, ctx()), []);
  });

  it("emits an assistant frame carrying timestamp_ms as a delta", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "PONG" }] },
      session_id: "s1",
      timestamp_ms: 1788336024112,
    });
    const turn: NormalizeTurnState = { emittedText: false };
    const [event] = normalizeLine(line, ctx(turn));
    assert.deepEqual(event, {
      type: "text.delta",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      text: "PONG",
    });
    assert.equal(turn.emittedText, true);
  });

  it("drops the final whole-turn assistant frame once deltas already streamed", () => {
    // Captured live: counting to 5 produced one delta per token/newline (each
    // with timestamp_ms), then a final frame with the full "1\n2\n3\n4\n5" and
    // no timestamp_ms — that final frame must not double the reply.
    const turn: NormalizeTurnState = { emittedText: true };
    const final = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "1\n2\n3\n4\n5" }] },
      session_id: "s1",
    });
    assert.deepEqual(normalizeLine(final, ctx(turn)), []);
  });

  it("falls back to the final assistant frame when nothing streamed", () => {
    const turn: NormalizeTurnState = { emittedText: false };
    const final = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "whole reply" }] },
      session_id: "s1",
    });
    const [event] = normalizeLine(final, ctx(turn));
    assert.equal(event?.type, "text.delta");
    if (event?.type === "text.delta") assert.equal(event.text, "whole reply");
    assert.equal(turn.emittedText, true);
  });

  it("normalizes a started/completed tool_call pair off its ...ToolCall key", () => {
    const started = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      call_id: "tool_31406da4-9804-4f5d-bf4b-6e922cc2026",
      tool_call: {
        readToolCall: { args: { path: "/tmp/curtest3/note.txt" } },
        toolCallId: "tool_31406da4-9804-4f5d-bf4b-6e922cc2026",
      },
      session_id: "s1",
    });
    const [startEvent] = normalizeLine(started, ctx());
    assert.deepEqual(startEvent, {
      type: "tool.start",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      toolUseId: "tool_31406da4-9804-4f5d-bf4b-6e922cc2026",
      name: "read",
      input: { path: "/tmp/curtest3/note.txt" },
    });

    const completed = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      call_id: "tool_31406da4-9804-4f5d-bf4b-6e922cc2026",
      tool_call: {
        readToolCall: {
          args: { path: "/tmp/curtest3/note.txt" },
          result: { success: { content: "hello world\n" } },
        },
      },
      session_id: "s1",
    });
    const [endEvent] = normalizeLine(completed, ctx());
    assert.equal(endEvent?.type, "tool.end");
    if (endEvent?.type === "tool.end") {
      assert.equal(endEvent.toolUseId, "tool_31406da4-9804-4f5d-bf4b-6e922cc2026");
      assert.equal(endEvent.isError, false);
    }
  });

  it("marks a tool_call whose result carries an error key as isError", () => {
    const completed = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      call_id: "t1",
      tool_call: { shellToolCall: { args: {}, result: { error: "command not found" } } },
      session_id: "s1",
    });
    const [event] = normalizeLine(completed, ctx());
    assert.equal(event?.type, "tool.end");
    if (event?.type === "tool.end") assert.equal(event.isError, true);
  });

  it("reports a successful result as turn.end with token usage", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 3140,
      is_error: false,
      result: "1\n2\n3\n4\n5",
      session_id: "s1",
      usage: { inputTokens: 4443, outputTokens: 41, cacheReadTokens: 8881, cacheWriteTokens: 0 },
    });
    const turn: NormalizeTurnState = { emittedText: true };
    const events = normalizeLine(line, ctx(turn));
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: "turn.end",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      usage: { inputTokens: 4443, outputTokens: 41, cacheReadTokens: 8881, cacheWriteTokens: 0 },
      totalCostUsd: 0,
      durationMs: 3140,
      numTurns: 1,
    });
    // Reset for the next turn.
    assert.equal(turn.emittedText, false);
  });

  it("surfaces an is_error result's text only when nothing streamed, then errors", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "You're out of usage. Switch to Auto.",
      session_id: "s1",
      usage: {},
    });
    const events = normalizeLine(line, ctx({ emittedText: false }));
    assert.equal(events.length, 3);
    assert.equal(events[0]?.type, "text.delta");
    assert.equal(events[1]?.type, "turn.end");
    assert.equal(events[2]?.type, "error");
  });

  it("does not replay an is_error result's text once deltas already streamed", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "already said this",
      session_id: "s1",
      usage: {},
    });
    const events = normalizeLine(line, ctx({ emittedText: true }));
    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, "turn.end");
    assert.equal(events[1]?.type, "error");
  });

  it("returns nothing for an unparseable line — the CLI's own tracing noise", () => {
    assert.deepEqual(
      normalizeLine("cursor-retrieval: tracing to '/tmp/cursor_retrieval.log'", ctx()),
      [],
    );
  });

  it("returns nothing for an unrecognized frame type", () => {
    assert.deepEqual(normalizeLine(JSON.stringify({ type: "something_new" }), ctx()), []);
  });
});
