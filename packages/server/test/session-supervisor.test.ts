import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdapterSessionStore,
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
    setPermissionMode: () => {},
    resolvePermission: () => {},
    close: async () => {},
  };
}

/** A minimal `AgentAdapter` whose `sessions` store is entirely overridable —
 * every real adapter (claude-code, cursor) resolves session storage through
 * this same interface, so a fake one is what `getAdapter` hands the
 * supervisor under test. */
function fakeAdapter(
  overrides: Partial<AdapterSessionStore> & {
    resumeSession?: AgentAdapter["resumeSession"];
  } = {},
): AgentAdapter {
  const { resumeSession, ...store } = overrides;
  return {
    id: "claude-code",
    capabilities: {} as AgentAdapter["capabilities"],
    async createSession(): Promise<SessionHandle> {
      throw new Error("not used by these tests");
    },
    resumeSession:
      resumeSession ??
      (async () => {
        throw new Error("resumeSession not stubbed for this test");
      }),
    async listSessions(): Promise<SessionMeta[]> {
      return [];
    },
    getStatus: async () => ({ authenticated: true }),
    sessions: {
      listProjectSessions: store.listProjectSessions ?? (async () => []),
      readSessionHistory: store.readSessionHistory ?? (async () => []),
      openSession: store.openSession ?? (async () => fakeHandle([])),
      mintSessionId: store.mintSessionId ?? (async () => "id"),
      lookupSessionTitle: store.lookupSessionTitle ?? (async () => undefined),
      deleteSession: store.deleteSession ?? (async () => {}),
    },
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
        fakeAdapter({
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
        }),
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

  it("refuses a provider that cannot manage sessions", async () => {
    const frames: ServerMessage[] = [];
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "codex",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        ({
          id: "codex",
          capabilities: {} as AgentAdapter["capabilities"],
          createSession: async () => {
            throw new Error("unused");
          },
          resumeSession: async () => {
            throw new Error("unused");
          },
          listSessions: async () => [],
          getStatus: async () => ({ authenticated: true }),
          // No `sessions` — a catalog stub's actual shape.
        }) as AgentAdapter,
    });

    const result = await supervisor.list();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /cannot manage sessions/);
  });

  it("marks only the session a live loop run owns", async () => {
    const frames: ServerMessage[] = [];
    const meta = (id: string): SessionMeta => ({
      id,
      adapterId: "claude-code",
      projectDir: "/workspace/demo",
      model: "",
      status: "dormant",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
      totalCostUsd: 0,
    });
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          listProjectSessions: async () => [meta("loop-sid"), meta("mine")],
        }),
      loopSessionIndex: async () =>
        new Map([
          ["loop-sid", { slug: "demo", pid: 7, startedAt: "", sessionId: "loop-sid" }],
        ]),
    });

    await supervisor.list();
    const list = frames.find((f) => f.type === "session.list");
    assert.ok(list && list.type === "session.list");
    if (list.type === "session.list") {
      const loop = list.sessions.find((s) => s.id === "loop-sid");
      const mine = list.sessions.find((s) => s.id === "mine");
      assert.equal(loop?.origin, "loop");
      assert.equal(loop?.loopWorkspace, "demo");
      // Named for what it is. Left to the transcript, every loop row would
      // read "Read /app/loop/overseer.md and act…" — the same string in every
      // workspace, and not the name the console window uses.
      assert.equal(loop?.name, "loop · demo");
      assert.equal(mine?.origin, undefined);
      assert.equal(mine?.name, undefined);
    }
  });

  it("refuses to open a live loop run rather than resuming it", async () => {
    // Two CLIs on one transcript corrupts it, and nothing else locks against
    // that — so the refusal has to come before both backfill and spawn.
    const frames: ServerMessage[] = [];
    let resumed = 0;
    let backfilled = 0;
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          resumeSession: async () => {
            resumed += 1;
            throw new Error("must not resume a loop run");
          },
          readSessionHistory: async () => {
            backfilled += 1;
            return [];
          },
        }),
      loopSessionIndex: async () =>
        new Map([
          ["loop-sid", { slug: "demo", pid: 7, startedAt: "", sessionId: "loop-sid" }],
        ]),
    });

    const result = await supervisor.open("loop-sid");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /live loop run/);
    assert.equal(resumed, 0);
    assert.equal(backfilled, 0);
    assert.equal(
      frames.some((f) => f.type === "session.history"),
      false,
    );
  });

  it("reports a clean failure, not an unhandled rejection, when mintSessionId throws", async () => {
    // mintSessionId is async to leave room for a provider whose id must
    // round-trip its own CLI, even though neither shipped adapter does that
    // today. Before this had its own try/catch (mirroring openSession's), a
    // throw here rejected the whole `create()` call, which nothing in ws.ts
    // catches: the operator's click got no response at all, not even a
    // benign error frame.
    const frames: ServerMessage[] = [];
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "cursor",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          mintSessionId: async () => {
            throw new Error("could not mint a session id");
          },
        }),
    });

    const result = await supervisor.create({});
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /could not mint a session id/);
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
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => fakeHandle([init]),
        }),
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
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => handle,
        }),
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
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => fakeHandle([init, modelSwitch]),
        }),
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

  it("retargets a live session's permission mode", async () => {
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
    let requestedMode: string | undefined;
    const handle: SessionHandle = {
      ...fakeHandle([init]),
      setPermissionMode: (mode) => {
        requestedMode = mode;
      },
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => handle,
        }),
    });

    await supervisor.create({});
    const result = await supervisor.setPermissionMode("new-id", "plan");

    assert.equal(result.ok, true);
    assert.equal(requestedMode, "plan");
  });

  it("folds a confirmed session.mode event into meta without waiting for another session.init", async () => {
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
    const modeSwitch: AgentEvent = {
      type: "session.mode",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:01.000Z",
      mode: "plan",
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => fakeHandle([init, modeSwitch]),
        }),
    });

    await supervisor.create({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const metas = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.meta" }> =>
        f.type === "session.meta",
    );
    assert.equal(metas.at(-1)?.session.permissionMode, "plan");
  });

  it("queues a permission request instead of auto-denying it", async () => {
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
    const request: AgentEvent = {
      type: "permission.request",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:01.000Z",
      requestId: "req-1",
      toolName: "Bash",
      input: { command: "ls" },
    };
    const resolved: unknown[] = [];
    const handle: SessionHandle = {
      ...fakeHandle([init, request]),
      resolvePermission: (id, decision) => {
        resolved.push({ id, decision });
      },
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => handle,
        }),
    });

    await supervisor.create({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Nothing auto-resolved it — the operator hasn't answered yet.
    assert.deepEqual(resolved, []);
    const events = frames.filter(
      (f): f is Extract<ServerMessage, { type: "session.event" }> =>
        f.type === "session.event",
    );
    assert.ok(
      events.some((f) => f.event.type === "permission.request"),
      "the raw request reaches the client like any other session event",
    );
  });

  it("resolveApproval answers the pending request with the operator's decision", async () => {
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
    const request: AgentEvent = {
      type: "permission.request",
      sessionId: "new-id",
      timestamp: "2026-01-01T00:00:01.000Z",
      requestId: "req-1",
      toolName: "Bash",
      input: { command: "ls" },
    };
    const resolved: unknown[] = [];
    const handle: SessionHandle = {
      ...fakeHandle([init, request]),
      resolvePermission: (id, decision) => {
        resolved.push({ id, decision });
      },
    };
    const supervisor = createSessionSupervisor((msg) => frames.push(msg), {
      readSnapshot: async () => ({
        attached_provider: "claude-code",
        last_active_project: "/workspace/demo",
      }),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        fakeAdapter({
          mintSessionId: async () => "new-id",
          openSession: async () => handle,
        }),
    });

    await supervisor.create({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = supervisor.resolveApproval("new-id", "req-1", {
      decision: "allow-once",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(resolved, [
      { id: "req-1", decision: { decision: "allow-once" } },
    ]);
  });

  it("refuses to resolve an approval on a session that is not live", () => {
    const supervisor = createSessionSupervisor(() => {});
    const result = supervisor.resolveApproval("no-such-session", "req-1", {
      decision: "deny",
    });
    assert.equal(result.ok, false);
  });

  it("does not reap an idle session with a pending approval", async () => {
    const frames: ServerMessage[] = [];
    const init: AgentEvent = {
      type: "session.init",
      sessionId: "idle-id",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: "claude-sonnet-5",
      cwd: "/workspace/demo",
      tools: [],
      mcpServers: [],
      slashCommands: [],
    };
    const request: AgentEvent = {
      type: "permission.request",
      sessionId: "idle-id",
      timestamp: "2026-01-01T00:00:01.000Z",
      requestId: "req-1",
      toolName: "Bash",
      input: { command: "ls" },
    };
    let closed = false;
    const handle: SessionHandle = {
      ...fakeHandle([init, request]),
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
        fakeAdapter({
          mintSessionId: async () => "idle-id",
          openSession: async () => handle,
        }),
      idleReapMs: 20,
    });

    await supervisor.create({});
    await new Promise((r) => setTimeout(r, 120));

    // A lost `can_use_tool` request has no way to be redelivered after a
    // `--resume` — reaping here would strand the operator's decision.
    assert.equal(closed, false);
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
        fakeAdapter({
          resumeSession: async () => {
            resumed = true;
            return handle;
          },
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
        }),
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
        fakeAdapter({
          mintSessionId: async () => "cost-id",
          openSession: async () => fakeHandle(events),
        }),
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
        fakeAdapter({
          mintSessionId: async () => "idle-id",
          openSession: async () => handle,
        }),
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
        fakeAdapter({
          mintSessionId: async () => "live-id",
          openSession: async () => fakeHandle([]),
          readSessionHistory: async () => {
            historyReads += 1;
            return [{ id: "t1", kind: "user", text: "hello" }];
          },
        }),
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
        fakeAdapter({
          mintSessionId: async () => "gone-id",
          openSession: async () => handle,
          deleteSession: async (projectDir, sessionId) => {
            deletedProject = projectDir;
            deletedId = sessionId;
          },
        }),
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
        fakeAdapter({
          deleteSession: async (_projectDir, sessionId) => {
            deletedId = sessionId;
          },
        }),
    });

    const result = await supervisor.delete("dormant-id");

    assert.equal(result.ok, true);
    assert.equal(deletedId, "dormant-id");
  });
});
