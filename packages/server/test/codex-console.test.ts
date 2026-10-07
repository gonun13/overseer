import assert from "node:assert/strict";
import { it } from "node:test";
import { codexAdapter } from "@overseer/adapter-codex";
import type {
  AgentAdapter,
  ConsoleExit,
  SessionMeta,
} from "@overseer/protocol";
import { createConsoleRegistry } from "../src/console-registry.js";
import { createCallsignBook } from "../src/callsigns.js";
import { createSessionIndex } from "../src/session-index.js";
import type { PtyHandle } from "../src/pty.js";

function harness(opts: { spawnFails?: boolean; mintFails?: boolean } = {}) {
  const prepared: Array<{ projectDir: string; prompt?: string }> = [];
  const discarded: string[] = [];
  const deleted: string[] = [];
  const commands: string[][] = [];
  const exits: Array<(info: ConsoleExit) => void> = [];
  const callsigns = createCallsignBook({
    read: async () => ({}),
    write: async () => undefined,
  });
  const adapter: AgentAdapter = {
    ...codexAdapter,
    getStatus: async () => ({ authenticated: true }),
    sessions: {
      ...codexAdapter.sessions!,
      async mintSessionId(context) {
        prepared.push(context);
        if (opts.mintFails) throw new Error("prepare failed");
        return "native-thread";
      },
      async discardPreparedSession(_dir, id) {
        discarded.push(id);
      },
      async deleteSession(_dir, id) {
        deleted.push(id);
      },
      async listProjectSessions(dir) {
        return [
          {
            id: "native-thread",
            adapterId: "codex",
            projectDir: dir,
            status: "dormant",
            createdAt: "2026-10-01T00:00:00Z",
            lastActiveAt: "2026-10-01T00:00:00Z",
            totalCostUsd: 0,
          } satisfies SessionMeta,
        ];
      },
    },
  };
  const registry = createConsoleRegistry({
    broadcast: () => {},
    getAdapter: () => adapter,
    callsigns,
    isInsideWorkspace: async () => true,
    recordAction: async () => undefined,
    loopSessionIndex: async () => new Map(),
    async spawn(command) {
      commands.push(command.args);
      if (opts.spawnFails) throw new Error("spawn failed");
      return {
        pid: 1,
        onData() {},
        onExit(fn) {
          exits.push(fn);
        },
        write() {},
        resize() {},
        kill() {
          exits.forEach((fn) => fn({ exitCode: 0 }));
        },
        done: Promise.resolve({ exitCode: 0 }),
      } satisfies PtyHandle;
    },
  });
  const index = createSessionIndex(() => {}, {
    listAdapters: () => [adapter],
    listProjects: async () => ["/workspace/a"],
    sweepDeadLoopSessions: async () => [],
    loopSessionIndex: async () => new Map(),
    isRunning: (id) => registry.findBySession(id) !== undefined,
    recordAction: async () => undefined,
    callsignOf: (id) => callsigns.nameOf(id),
  });
  return { registry, index, prepared, discarded, deleted, commands, callsigns };
}
const request = {
  kind: "agent" as const,
  providerId: "codex",
  projectPath: "/workspace/a",
  cols: 80,
  rows: 24,
};

it("Codex prepares a linked session and preserves its callsign across concurrent resume attachment", async () => {
  const h = harness();
  try {
    const result = await h.registry.open({ ...request, prompt: "fix the bug" });
    assert.ok(result.ok);
    assert.equal(result.console.sessionId, "native-thread");
    assert.deepEqual(h.prepared, [
      { projectDir: "/workspace/a", prompt: "fix the bug" },
    ]);
    assert.deepEqual(h.commands, [
      [
        "resume",
        "--no-daemon",
        "--sandbox",
        "danger-full-access",
        "native-thread",
        "--",
        "fix the bug",
      ],
    ]);
    const originalCallsign = result.console.callsign;
    h.registry.kill(result.console.id);
    const pair = await Promise.all(
      [1, 2].map(() =>
        h.registry.open({
          ...request,
          sessionId: "native-thread",
          resume: true,
        }),
      ),
    );
    assert.ok(pair[0]!.ok && pair[1]!.ok);
    assert.equal(pair[0]!.console.id, pair[1]!.console.id);
    assert.equal(pair[1]!.attached, true);
    assert.equal(pair[0]!.console.callsign, originalCallsign);
    assert.equal(h.commands.length, 2);
    await h.index.list();
    assert.equal((await h.index.delete("native-thread")).ok, false);
    assert.deepEqual(h.deleted, []);
    h.registry.kill(pair[0]!.console.id);
    assert.equal((await h.index.delete("native-thread")).ok, true);
    assert.deepEqual(h.deleted, ["native-thread"]);
  } finally {
    h.registry.dispose();
  }
});

it("Codex preparation failure refuses the console without spawning", async () => {
  const h = harness({ mintFails: true });
  assert.equal((await h.registry.open(request)).ok, false);
  assert.equal(h.commands.length, 0);
});

it("Codex spawn failure discards only the freshly prepared thread and releases its callsign", async () => {
  const h = harness({ spawnFails: true });
  assert.equal((await h.registry.open(request)).ok, false);
  assert.deepEqual(h.discarded, ["native-thread"]);
  assert.equal(h.callsigns.nameOf("native-thread"), undefined);
  assert.equal(
    (
      await h.registry.open({
        ...request,
        sessionId: "saved-thread",
        resume: true,
      })
    ).ok,
    false,
  );
  assert.deepEqual(h.discarded, ["native-thread"]);
});
