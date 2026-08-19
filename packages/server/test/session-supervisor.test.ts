import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentAdapter,
  AgentEvent,
  SessionHandle,
  SessionMeta,
  ServerMessage,
} from "@overseer/protocol";
import { createSessionSupervisor } from "../src/session-supervisor.js";

function fakeHandle(events: AgentEvent[]): SessionHandle {
  async function* gen() {
    for (const event of events) yield event;
  }
  return {
    events: gen(),
    send: () => {},
    interrupt: () => {},
    setModel: () => {},
    resolvePermission: () => {},
    close: async () => {},
  };
}

describe("session-supervisor", () => {
  it("lists sessions for the active project", async () => {
    const frames: ServerMessage[] = [];
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      listProjectSessions: async () => [
        {
          id: "s1",
          adapterId: "claude-code",
          projectDir: "/workspace/demo",
          model: "",
          status: "dormant",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
          totalCostUsd: 0,
        },
      ],
    });

    const result = await supervisor.list();
    assert.equal(result.ok, true);
    const list = frames.find((f) => f.type === "session.list");
    assert.ok(list && list.type === "session.list");
    if (list.type === "session.list") {
      assert.equal(list.sessions.length, 1);
      assert.equal(list.sessions[0]?.id, "s1");
    }
  });

  it("creates a session and broadcasts meta", async () => {
    const frames: ServerMessage[] = [];
    const init: AgentEvent = {
      type: "session.init",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: "claude-sonnet-4",
      cwd: "/workspace/demo",
      tools: [],
      mcpServers: [],
      slashCommands: [],
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      mintSessionId: () => "new-id",
      openSession: () => fakeHandle([init]),
      listProjectSessions: async () => [],
      recordAction: async () => {},
    });

    const result = await supervisor.create({});
    assert.equal(result.ok, true);
    assert.ok(frames.some((f) => f.type === "session.meta"));
    assert.ok(frames.some((f) => f.type === "session.event"));
  });

  it("retargets a live session and folds the confirmed model into its meta", async () => {
    const frames: ServerMessage[] = [];
    const init: AgentEvent = {
      type: "session.init",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: "claude-sonnet-5",
      cwd: "/workspace/demo",
      tools: [],
      mcpServers: [],
      slashCommands: [],
    };
    let requestedModel: string | undefined;
    const handle: SessionHandle = {
      ...fakeHandle([init]),
      setModel: (model) => {
        requestedModel = model;
      },
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      mintSessionId: () => "new-id",
      openSession: () => handle,
      listProjectSessions: async () => [],
      recordAction: async () => {},
    });

    await supervisor.create({});
    const result = await supervisor.setModel("new-id", "haiku");

    assert.equal(result.ok, true);
    assert.equal(requestedModel, "haiku");
  });

  it("folds a confirmed session.model event into meta without waiting for another session.init", async () => {
    // The running process never respawns on a runtime switch, so nothing
    // re-fires session.init — session.model is the only signal meta.model
    // ever gets that it changed.
    const frames: ServerMessage[] = [];
    const init: AgentEvent = {
      type: "session.init",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: "claude-sonnet-5",
      cwd: "/workspace/demo",
      tools: [],
      mcpServers: [],
      slashCommands: [],
    };
    const modelSwitch: AgentEvent = {
      type: "session.model",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:01.000Z",
      model: "claude-haiku-4-5-20251001",
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      mintSessionId: () => "new-id",
      openSession: () => fakeHandle([init, modelSwitch]),
      listProjectSessions: async () => [],
      recordAction: async () => {},
    });

    await supervisor.create({});
    // The pump drains the fake handle's events off a microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const metas = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.meta" }> =>
        f.type === "session.meta",
    );
    assert.equal(metas.at(-1)?.session.model, "claude-haiku-4-5-20251001");
  });

  it("send opens a dormant session before delivering the message", async () => {
    let resumed = false;
    const frames: ServerMessage[] = [];
    const handle = fakeHandle([]);
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
          resumeSession: async () => {
            resumed = true;
            return handle;
          },
        }) as AgentAdapter,
      listProjectSessions: async () => [
        {
          id: "s1",
          adapterId: "claude-code",
          projectDir: "/workspace/demo",
          model: "",
          status: "dormant",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
          totalCostUsd: 0,
        },
      ],
      readSessionHistory: async () => [],
    });

    const result = await supervisor.send("s1", "hello");
    assert.equal(result.ok, true);
    assert.equal(resumed, true);
  });

  it("keeps the running cost when a turn is interrupted", async () => {
    // An interrupted turn reports `error_during_execution` with no usage; the
    // zeroed result must not wipe what the session has already spent.
    const frames: ServerMessage[] = [];
    const events: AgentEvent[] = [
      {
        type: "turn.end",
        sessionId: "cost-id",
        timestamp: "2026-01-01T00:00:00.000Z",
        usage: { inputTokens: 10, outputTokens: 5 },
        totalCostUsd: 0.42,
        durationMs: 100,
        numTurns: 1,
      },
      {
        type: "turn.end",
        sessionId: "cost-id",
        timestamp: "2026-01-01T00:00:01.000Z",
        usage: { inputTokens: 0, outputTokens: 0 },
        totalCostUsd: 0,
        durationMs: 0,
        numTurns: 0,
      },
    ];
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      listProjectSessions: async () => [],
      recordAction: async () => {},
      mintSessionId: () => "cost-id",
      openSession: () => fakeHandle(events),
      lookupSessionTitle: async () => undefined,
    });

    await supervisor.create({});
    await new Promise((r) => setTimeout(r, 20));

    const metas = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.meta" }> =>
        f.type === "session.meta",
    );
    assert.equal(metas.at(-1)?.session.totalCostUsd, 0.42);
  });

  it("reaps an idle session and leaves it resumable", async () => {
    const frames: ServerMessage[] = [];
    let closed = false;
    const handle: SessionHandle = {
      ...fakeHandle([]),
      close: async () => {
        closed = true;
      },
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      listProjectSessions: async () => [],
      recordAction: async () => {},
      mintSessionId: () => "idle-id",
      openSession: () => handle,
      lookupSessionTitle: async () => undefined,
      idleReapMs: 20,
    });

    await supervisor.create({});
    await new Promise((r) => setTimeout(r, 120));

    assert.equal(closed, true);
    const metas = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.meta" }> =>
        f.type === "session.meta",
    );
    // Dormant, not closed: the next message resumes it from its JSONL.
    assert.equal(metas.at(-1)?.session.status, "dormant");
  });

  it("resends history on open even when the session is already live", async () => {
    // A second tab, or the same tab after a reconnect, asking to open a
    // session that never got reaped used to get nothing: `ensureOpen` is a
    // no-op once a process is already tracked live, so history was only ever
    // sent the first time anyone resumed it in this server's lifetime.
    const frames: ServerMessage[] = [];
    let historyReads = 0;
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      listProjectSessions: async () => [],
      recordAction: async () => {},
      mintSessionId: () => "live-id",
      openSession: () => fakeHandle([]),
      lookupSessionTitle: async () => undefined,
      readSessionHistory: async () => {
        historyReads += 1;
        return [{ id: "t1", kind: "user", text: "hello" }];
      },
    });

    await supervisor.create({});
    assert.equal(historyReads, 0); // create() starts fresh, no backfill needed

    await supervisor.open("live-id");
    await supervisor.open("live-id");

    assert.equal(historyReads, 2);
    const histories = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.history" }> =>
        f.type === "session.history",
    );
    assert.equal(histories.length, 2);
    assert.deepEqual(histories[0]?.turns, [
      { id: "t1", kind: "user", text: "hello" },
    ]);
  });

  it("closes a live process and deletes the transcript", async () => {
    const frames: ServerMessage[] = [];
    let closed = false;
    let deletedProject: string | undefined;
    let deletedId: string | undefined;
    const handle: SessionHandle = {
      ...fakeHandle([]),
      close: async () => {
        closed = true;
      },
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      listProjectSessions: async () => [],
      recordAction: async () => {},
      mintSessionId: () => "gone-id",
      openSession: () => handle,
      lookupSessionTitle: async () => undefined,
      deleteSession: async (projectDir, sessionId) => {
        deletedProject = projectDir;
        deletedId = sessionId;
      },
    });

    await supervisor.create({});
    const result = await supervisor.delete("gone-id");

    assert.equal(result.ok, true);
    assert.equal(closed, true); // stopped whatever was running
    assert.equal(deletedProject, "/workspace/demo");
    assert.equal(deletedId, "gone-id");

    const lists = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.list" }> =>
        f.type === "session.list",
    );
    assert.ok(lists.length > 0);
    assert.equal(
      lists.at(-1)?.sessions.some((s) => s.id === "gone-id"),
      false,
    );
  });

  it("deletes a dormant session without touching a process", async () => {
    // Nothing is running, so there is nothing to stop — only the transcript
    // needs to go.
    const frames: ServerMessage[] = [];
    let deletedId: string | undefined;
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "claude-code",
          getStatus: async () => ({ authenticated: true }),
        }) as AgentAdapter,
      listProjectSessions: async () => [],
      recordAction: async () => {},
      deleteSession: async (_projectDir, sessionId) => {
        deletedId = sessionId;
      },
    });

    const result = await supervisor.delete("dormant-id");

    assert.equal(result.ok, true);
    assert.equal(deletedId, "dormant-id");
  });
});
