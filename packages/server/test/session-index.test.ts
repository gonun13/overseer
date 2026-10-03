import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAdapter, ServerMessage, SessionMeta } from "@overseer/protocol";
import { createSessionIndex } from "../src/session-index.js";

/** The workspace-wide session list, and the guards on deleting from it. */

function meta(id: string, adapterId: string, projectDir: string, at: string): SessionMeta {
  return {
    id,
    adapterId,
    projectDir,
    status: "dormant",
    createdAt: at,
    lastActiveAt: at,
    totalCostUsd: 0,
  };
}

function fakeAdapter(id: string, byProject: Record<string, SessionMeta[]>, deleted: string[]) {
  return {
    id,
    capabilities: { login: true, usageCheck: false },
    getStatus: async () => ({ authenticated: true }),
    sessions: {
      listProjectSessions: async (dir: string) => byProject[dir] ?? [],
      mintSessionId: async () => "new",
      lookupSessionTitle: async () => undefined,
      deleteSession: async (_dir: string, sessionId: string) => {
        deleted.push(sessionId);
      },
    },
  } satisfies AgentAdapter;
}

function harness(opts: { running?: string[]; loops?: string[] } = {}) {
  const broadcasts: ServerMessage[] = [];
  const deleted: string[] = [];
  const claude = fakeAdapter(
    "claude",
    {
      "/workspace/a": [meta("c1", "claude", "/workspace/a", "2026-10-01T00:00:00Z")],
      "/workspace/b": [meta("c2", "claude", "/workspace/b", "2026-10-02T00:00:00Z")],
    },
    deleted,
  );
  const cursor = fakeAdapter(
    "cursor",
    { "/workspace/a": [meta("u1", "cursor", "/workspace/a", "2026-09-30T00:00:00Z")] },
    deleted,
  );
  const stub = { id: "codex", capabilities: { login: false, usageCheck: false }, getStatus: async () => ({ authenticated: false }) };
  const index = createSessionIndex((m) => broadcasts.push(m), {
    listAdapters: () => [claude, cursor, stub],
    listProjects: async () => ["/workspace/a", "/workspace/b"],
    loopSessionIndex: async () =>
      new Map((opts.loops ?? []).map((id) => [id, { slug: "a", pid: 1, sessionId: id } as never])),
    sweepDeadLoopSessions: async () => [],
    isRunning: (id) => (opts.running ?? []).includes(id),
    recordAction: async () => undefined,
  });
  return { index, broadcasts, deleted };
}

describe("session index", () => {
  it("lists every project's sessions from every provider, newest first", async () => {
    const { index, broadcasts } = harness();
    const sessions = await index.list();
    assert.deepEqual(
      sessions.map((s) => s.id),
      ["c2", "c1", "u1"],
    );
    assert.equal(broadcasts.at(-1)?.type, "session.list");
  });

  it("names a loop run after its workspace and marks it", async () => {
    const { index } = harness({ loops: ["c1"] });
    const sessions = await index.list();
    const loop = sessions.find((s) => s.id === "c1");
    assert.equal(loop?.origin, "loop");
    assert.equal(loop?.loopWorkspace, "a");
  });

  it("deletes through the adapter that owns the session", async () => {
    const { index, deleted } = harness();
    await index.list();
    assert.deepEqual(await index.delete("u1"), { ok: true });
    assert.deepEqual(deleted, ["u1"]);
  });

  it("refuses to delete a session a console is running, or a loop owns", async () => {
    const running = harness({ running: ["c1"] });
    await running.index.list();
    assert.equal((await running.index.delete("c1")).ok, false);
    assert.deepEqual(running.deleted, []);

    const loop = harness({ loops: ["c2"] });
    await loop.index.list();
    assert.equal((await loop.index.delete("c2")).ok, false);
  });

  it("refuses an id it has not listed", async () => {
    const { index } = harness();
    assert.equal((await index.delete("nope")).ok, false);
  });
});
