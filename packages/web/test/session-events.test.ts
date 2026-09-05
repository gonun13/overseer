import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Chat } from "../src/state/session-events.ts";
import {
  appendUserTurn,
  applySessionEvent,
  metaToSession,
  parseApprovalQuestions,
  reconcileSessionList,
} from "../src/state/session-events.ts";

describe("question requests", () => {
  const ASK_INPUT = {
    questions: [
      {
        question: "Which bash?",
        header: "Shell",
        multiSelect: false,
        options: [
          { label: "pure bash", description: "no dependencies" },
          { label: "zsh", description: "nicer, less portable" },
        ],
      },
    ],
  };

  it("reads a question tool's questions off its input", () => {
    const questions = parseApprovalQuestions("AskUserQuestion", ASK_INPUT);
    assert.equal(questions?.length, 1);
    assert.equal(questions?.[0]?.header, "Shell");
    assert.equal(questions?.[0]?.options.length, 2);
  });

  it("leaves an ordinary tool alone", () => {
    assert.equal(
      parseApprovalQuestions("Write", { file_path: "/workspace/a.txt" }),
      undefined,
    );
  });

  it("falls back to a plain approval when the input does not read as questions", () => {
    // Better an approval the operator cannot answer than a card offering
    // options that were never actually asked.
    assert.equal(parseApprovalQuestions("AskUserQuestion", {}), undefined);
    assert.equal(
      parseApprovalQuestions("AskUserQuestion", { questions: [{ header: "x" }] }),
      undefined,
    );
    assert.equal(
      parseApprovalQuestions("AskUserQuestion", {
        questions: [{ question: "Which?", options: [] }],
      }),
      undefined,
    );
  });

  it("carries the questions onto the approval turn", () => {
    const chat = {
      session: metaToSession({
        id: "q1",
        adapterId: "claude-code",
        projectDir: "/workspace/demo",
        model: "",
        permissionMode: "default",
        status: "live" as const,
        createdAt: "",
        lastActiveAt: "",
        totalCostUsd: 0,
      }),
      turns: [],
    };
    const next = applySessionEvent(chat, {
      type: "permission.request",
      sessionId: "q1",
      timestamp: "",
      requestId: "req_1",
      toolName: "AskUserQuestion",
      input: ASK_INPUT,
    });
    const turn = next.turns[0];
    assert.equal(turn?.kind, "approval");
    assert.equal(
      turn?.kind === "approval" && turn.questions?.[0]?.question,
      "Which bash?",
    );
    assert.equal(next.session.doing, "waiting on your answer");
  });
});

describe("session-events", () => {
  it("maps session meta to UI session", () => {
    const session = metaToSession({
      id: "abc",
      adapterId: "claude-code",
      projectDir: "/workspace/demo",
      gitBranch: "main",
      model: "claude-sonnet-4",
      permissionMode: "auto",
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
      permissionMode: "auto",
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
        permissionMode: "auto",
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

  it("builds a thinking turn from deltas, separate from the reply that follows", () => {
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
    const thinking = (text: string) => ({
      type: "thinking.delta" as const,
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      text,
    });
    const text = (text: string) => ({
      type: "text.delta" as const,
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      text,
    });

    let chat = applySessionEvent(base, thinking("let me "));
    chat = applySessionEvent(chat, thinking("work through this"));
    chat = applySessionEvent(chat, text("42"));

    assert.equal(chat.turns.length, 2);
    const [reasoning, reply] = chat.turns;
    assert.equal(reasoning?.kind, "thinking");
    assert.equal(
      reasoning?.kind === "thinking" && reasoning.text,
      "let me work through this",
    );
    assert.equal(reply?.kind, "agent");
    assert.equal(reply?.kind === "agent" && reply.text, "42");
  });

  it("opens no turn at all for an empty thinking delta — Claude can withhold reasoning entirely", () => {
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
        turns: [],
      },
      {
        type: "thinking.delta",
        sessionId: "s1",
        timestamp: "2026-01-01T00:00:00.000Z",
        text: "",
      },
    );
    assert.equal(chat.turns.length, 0);
    assert.equal(chat.session.activity, "working");
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

  it("keeps a quota error's text after turn.end settles activity on attention", () => {
    // Adapter order for is_error results: text.delta → turn.end → error.
    // turn.end alone would leave the session idle with no visible reply.
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
      turns: [{ id: "s1-u0", kind: "user" as const, text: "hi" }],
    };
    const limit = "You've hit your weekly limit · resets 3am (UTC)";
    let chat = applySessionEvent(base, {
      type: "text.delta",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00.000Z",
      text: limit,
    });
    chat = applySessionEvent(chat, {
      type: "turn.end",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:01.000Z",
      usage: { inputTokens: 0, outputTokens: 0 },
      totalCostUsd: 0,
      durationMs: 12,
      numTurns: 1,
    });
    chat = applySessionEvent(chat, {
      type: "error",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: limit,
      recoverable: true,
    });
    assert.equal(chat.session.activity, "attention");
    assert.equal(chat.session.doing, limit);
    const reply = chat.turns.find((t) => t.kind === "agent");
    assert.equal(reply?.kind === "agent" && reply.text, limit);
  });
});

describe("reconcileSessionList", () => {
  function chatFor(projectDir: string, id: string, turns: Chat["turns"] = []): Chat {
    return {
      session: metaToSession({
        id,
        adapterId: "claude-code",
        projectDir,
        model: "",
        status: "live",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        totalCostUsd: 0,
      }),
      turns,
      settings: { model: "", mode: "", agent: "" },
    };
  }

  it("leaves another project's chats untouched — session.list only speaks for the active project", () => {
    // This is the project-switch bug: the server always scopes session.list
    // to whichever project is active right now, so a reply for project B
    // must not be read as "everything not in this list is gone" — that used
    // to wipe project A's transcripts out of memory the moment the operator
    // switched away, so switching back found them empty.
    const projectA = chatFor("/workspace/a", "a1", [
      { id: "a1-u0", kind: "user", text: "hello from A" },
    ]);
    const current = [projectA];

    const next = reconcileSessionList(current, [
      {
        id: "b1",
        adapterId: "claude-code",
        projectDir: "/workspace/b",
        model: "",
        status: "live",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        totalCostUsd: 0,
      },
    ]);

    const survivedA = next.find((c) => c.session.id === "a1");
    assert.ok(survivedA);
    assert.deepEqual(survivedA.turns, projectA.turns);
    assert.ok(next.some((c) => c.session.id === "b1"));
  });

  it("prunes a session that vanished from its own project's list", () => {
    const gone = chatFor("/workspace/a", "a1");
    const kept = chatFor("/workspace/a", "a2");

    const next = reconcileSessionList([gone, kept], [
      {
        id: "a2",
        adapterId: "claude-code",
        projectDir: "/workspace/a",
        model: "",
        status: "live",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        totalCostUsd: 0,
      },
    ]);

    assert.equal(next.some((c) => c.session.id === "a1"), false);
    assert.ok(next.some((c) => c.session.id === "a2"));
  });

  it("keeps existing turns when refreshing a known session's meta", () => {
    const existing = chatFor("/workspace/a", "a1", [
      { id: "a1-u0", kind: "user", text: "hi" },
    ]);

    const next = reconcileSessionList([existing], [
      {
        id: "a1",
        adapterId: "claude-code",
        projectDir: "/workspace/a",
        name: "renamed",
        model: "sonnet",
        status: "live",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:01.000Z",
        totalCostUsd: 0.02,
      },
    ]);

    const chat = next.find((c) => c.session.id === "a1");
    assert.deepEqual(chat?.turns, existing.turns);
    assert.equal(chat?.session.name, "renamed");
    assert.equal(chat?.settings.model, "sonnet");
  });
});
