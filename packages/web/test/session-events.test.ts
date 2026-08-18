import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendUserTurn,
  applySessionEvent,
  metaToSession,
} from "../src/state/session-events.ts";

describe("session-events", () => {
  it("maps session meta to UI session", () => {
    const session = metaToSession({
      id: "abc",
      adapterId: "claude-code",
      projectDir: "/workspace/demo",
      gitBranch: "main",
      model: "claude-sonnet-4",
      permissionMode: "default",
      status: "live",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
      totalCostUsd: 0.0123,
    });
    assert.equal(session.projectId, "/workspace/demo");
    assert.equal(session.cost, "$0.0123");
  });

  it("uses new session as the placeholder title", () => {
    const session = metaToSession({
      id: "abc",
      adapterId: "claude-code",
      projectDir: "/workspace/demo",
      model: "",
      permissionMode: "default",
      status: "live",
      createdAt: "",
      lastActiveAt: "",
      totalCostUsd: 0,
    });
    assert.equal(session.name, "new session");
  });

  it("appends text deltas to the agent turn", () => {
    const chat = {
      session: metaToSession({
        id: "abc",
        adapterId: "claude-code",
        projectDir: "/workspace/demo",
        model: "",
        permissionMode: "default",
        status: "live",
        createdAt: "",
        lastActiveAt: "",
        totalCostUsd: 0,
      }),
      turns: [],
    };
    const first = applySessionEvent(chat, {
      type: "text.delta",
      sessionId: "abc",
      timestamp: "",
      text: "hel",
    });
    const second = applySessionEvent(first, {
      type: "text.delta",
      sessionId: "abc",
      timestamp: "",
      text: "lo",
    });
    assert.equal(second.turns.length, 1);
    assert.equal(second.turns[0]?.kind === "agent" && second.turns[0].text, "hello");
  });

  it("gives every agent message its own turn id", () => {
    // Agent turns used to share one `agent-<sessionId>` id, so React saw
    // duplicate keys as soon as a session produced a second reply.
    const base = {
      session: metaToSession({
        id: "s1",
        adapterId: "claude-code",
        projectDir: "/workspace/demo",
        model: "",
        permissionMode: "default" as const,
        status: "live" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        totalCostUsd: 0,
      }),
      turns: [],
    };
    const delta = (text: string) => ({
      type: "text.delta" as const,
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      text,
    });

    let chat = applySessionEvent(base, delta("first"));
    chat = appendUserTurn(chat, "again");
    chat = applySessionEvent(chat, delta("second"));

    const ids = chat.turns.map((turn) => turn.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join()}`);
    const agents = chat.turns.filter((t) => t.kind === "agent");
    assert.equal(agents.length, 2);
    assert.equal(agents[0]?.kind === "agent" && agents[0].text, "first");
    assert.equal(agents[1]?.kind === "agent" && agents[1].text, "second");
  });

  it("closes a tool turn when its result lands", () => {
    const base = {
      session: metaToSession({
        id: "s1",
        adapterId: "claude-code",
        projectDir: "/workspace/demo",
        model: "",
        permissionMode: "default" as const,
        status: "live" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        totalCostUsd: 0,
      }),
      turns: [],
    };

    let chat = applySessionEvent(base, {
      type: "tool.start",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      toolUseId: "toolu_1",
      name: "Read",
      input: { file_path: "/etc/hostname" },
    });
    const started = chat.turns.at(-1);
    assert.equal(started?.kind === "tool" && started.status, "running");
    assert.equal(started?.kind === "tool" && started.target, "/etc/hostname");

    chat = applySessionEvent(chat, {
      type: "tool.end",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:01.000Z",
      toolUseId: "toolu_1",
      output: "630a97c9c118",
      isError: false,
    });
    const done = chat.turns.at(-1);
    assert.equal(done?.kind === "tool" && done.status, "ok");
    assert.equal(chat.turns.length, 1);
  });

  it("marks a failed tool result as an error", () => {
    const chat = applySessionEvent(
      {
        session: metaToSession({
          id: "s1",
          adapterId: "claude-code",
          projectDir: "/workspace/demo",
          model: "",
          permissionMode: "default" as const,
          status: "live" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
          totalCostUsd: 0,
        }),
        turns: [
          { id: "toolu_1", kind: "tool", tool: "Bash", target: "Bash", status: "running" },
        ],
      },
      {
        type: "tool.end",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
        toolUseId: "toolu_1",
        output: "<tool_use_error>Blocked</tool_use_error>",
        isError: true,
      },
    );
    const turn = chat.turns[0];
    assert.equal(turn?.kind === "tool" && turn.status, "error");
  });
});
