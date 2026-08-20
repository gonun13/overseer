import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { AgentEvent } from "@overseer/protocol";
import { normalizeLine } from "../src/normalize.js";

/**
 * Recorded from claude 2.1.226 running the adapter's own argv: one Read tool
 * call and a short reply. Regenerate by teeing stream-json stdout to a file.
 */
const FIXTURE = fileURLToPath(
  new URL("./fixtures/read-tool-session.ndjson", import.meta.url),
);

const ctx = {
  sessionId: "session-under-test",
  timestamp: () => "2026-08-18T00:00:00.000Z",
};

function replay(): AgentEvent[] {
  const raw = readFileSync(FIXTURE, "utf8");
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    events.push(...normalizeLine(line, ctx));
  }
  return events;
}

function textOf(events: AgentEvent[]): string {
  return events
    .filter(
      (e): e is Extract<AgentEvent, { type: "text.delta" }> =>
        e.type === "text.delta",
    )
    .map((e) => e.text)
    .join("");
}

describe("normalizeLine over a recorded session", () => {
  it("emits each assistant reply exactly once", () => {
    // --include-partial-messages sends the text as deltas and again whole on
    // the terminal `assistant` frame; only the deltas may be counted.
    assert.equal(textOf(replay()), "The hostname is `630a97c9c118`.");
  });

  it("emits one tool.start per call, carrying the resolved input", () => {
    const starts = replay().filter((e) => e.type === "tool.start");
    assert.equal(starts.length, 1);
    const start = starts[0] as Extract<AgentEvent, { type: "tool.start" }>;
    assert.equal(start.name, "Read");
    // content_block_start announces `input: {}` — the arguments only arrive
    // as input_json_delta, so a start-frame reading would lose the path.
    assert.deepEqual(start.input, { file_path: "/etc/hostname" });
  });

  it("closes the tool call with a matching tool.end", () => {
    const events = replay();
    const start = events.find((e) => e.type === "tool.start") as Extract<
      AgentEvent,
      { type: "tool.start" }
    >;
    const ends = events.filter(
      (e): e is Extract<AgentEvent, { type: "tool.end" }> =>
        e.type === "tool.end",
    );
    assert.equal(ends.length, 1);
    assert.equal(ends[0].toolUseId, start.toolUseId);
    assert.equal(ends[0].isError, false);
  });

  it("drops the replayed echo of our own input", () => {
    // --replay-user-messages echoes the operator's turn back flagged isReplay;
    // it must not be mistaken for a tool result or a new turn.
    const events = replay();
    assert.equal(
      events.some((e) => e.type === "tool.end" && e.output === null),
      false,
    );
    assert.equal(events.filter((e) => e.type === "turn.end").length, 1);
  });

  it("reports session.init and a costed turn.end", () => {
    const events = replay();
    const init = events.find((e) => e.type === "session.init") as Extract<
      AgentEvent,
      { type: "session.init" }
    >;
    assert.equal(init.cwd, "/workspace");
    assert.ok(init.tools.includes("Read"));
    const end = events.find((e) => e.type === "turn.end") as Extract<
      AgentEvent,
      { type: "turn.end" }
    >;
    assert.ok(end.totalCostUsd > 0);
    assert.ok(end.usage.outputTokens > 0);
  });

  it("stamps every event with the supervisor's session id", () => {
    // The CLI echoes its own session_id on each frame; events are keyed by the
    // id the supervisor minted so both sides agree.
    assert.ok(replay().every((e) => e.sessionId === "session-under-test"));
  });
});

describe("normalizeLine frame shapes", () => {
  it("reads parent_tool_use_id from the envelope, not the inner event", () => {
    const line = JSON.stringify({
      type: "stream_event",
      parent_tool_use_id: "toolu_parent",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "from a subagent" },
      },
    });
    const [event] = normalizeLine(line, ctx) as [
      Extract<AgentEvent, { type: "text.delta" }>,
    ];
    assert.equal(event.parentToolUseId, "toolu_parent");
  });

  it("parses a can_use_tool request from its nested request object", () => {
    const line = JSON.stringify({
      type: "control_request",
      request_id: "req_7",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "ls" },
      },
    });
    const [event] = normalizeLine(line, ctx) as [
      Extract<AgentEvent, { type: "permission.request" }>,
    ];
    assert.equal(event.type, "permission.request");
    assert.equal(event.requestId, "req_7");
    assert.equal(event.toolName, "Bash");
    assert.deepEqual(event.input, { command: "ls" });
  });

  it("surfaces a failed tool result as an errored tool.end", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_x",
            content: "<tool_use_error>Blocked</tool_use_error>",
            is_error: true,
          },
        ],
      },
    });
    const [event] = normalizeLine(line, ctx) as [
      Extract<AgentEvent, { type: "tool.end" }>,
    ];
    assert.equal(event.type, "tool.end");
    assert.equal(event.toolUseId, "toolu_x");
    assert.equal(event.isError, true);
  });

  it("ignores control responses and unknown frames", () => {
    const control = JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: "req_1", response: {} },
    });
    assert.deepEqual(normalizeLine(control, ctx), []);
    assert.deepEqual(normalizeLine('{"type":"rate_limit_event"}', ctx), []);
    assert.deepEqual(normalizeLine("not json at all", ctx), []);
  });

  it("surfaces an is_error result's text live — quota hits skip text deltas", () => {
    // Claude ends a hard limit with is_error + result copy and no
    // content_block_delta stream; dropping that string left the session
    // window blank until a reload hydrated the JSONL assistant turn.
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 429,
      result: "You've hit your weekly limit · resets 3am (UTC)",
      usage: { input_tokens: 0, output_tokens: 0 },
      total_cost_usd: 0,
      duration_ms: 12,
      num_turns: 1,
    });
    const events = normalizeLine(line, ctx);
    assert.deepEqual(
      events.map((e) => e.type),
      ["text.delta", "turn.end", "error"],
    );
    const text = events[0] as Extract<AgentEvent, { type: "text.delta" }>;
    const err = events[2] as Extract<AgentEvent, { type: "error" }>;
    assert.equal(text.text, "You've hit your weekly limit · resets 3am (UTC)");
    assert.equal(err.message, text.text);
    assert.equal(err.recoverable, true);
  });

  it("does not replay a successful result's text — deltas already carried it", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: false,
      result: "hello from the final frame",
      usage: { input_tokens: 1, output_tokens: 2 },
      total_cost_usd: 0.01,
      duration_ms: 100,
      num_turns: 1,
    });
    const events = normalizeLine(line, ctx);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "turn.end");
  });

  it("takes assistant text when the turn skipped stream deltas", () => {
    const turn = { emittedText: false };
    const withTurn = { ...ctx, turn };
    const assistant = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "You've hit your weekly limit · resets 3am (UTC)",
          },
        ],
      },
    });
    const events = normalizeLine(assistant, withTurn);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "text.delta");
    assert.equal(
      (events[0] as Extract<AgentEvent, { type: "text.delta" }>).text,
      "You've hit your weekly limit · resets 3am (UTC)",
    );
    assert.equal(turn.emittedText, true);
  });

  it("does not double assistant text after stream deltas for the same turn", () => {
    const turn = { emittedText: false };
    const withTurn = { ...ctx, turn };
    normalizeLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "hello" },
        },
      }),
      withTurn,
    );
    const events = normalizeLine(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      }),
      withTurn,
    );
    assert.equal(events.length, 0);
  });
});
