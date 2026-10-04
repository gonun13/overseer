import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentAdapter,
  ConsoleActivity,
  ConsoleInfo,
  ServerMessage,
  SessionMeta,
} from "@overseer/protocol";
import { createCallsignBook } from "../src/callsigns.js";
import type { OpenRequest, OpenResult } from "../src/console-registry.js";
import type { StatusInput } from "../src/overseer/space.js";
import { createRelay, nextDraft, type RelayLimits } from "../src/relay.js";

/**
 * Relay against a fake registry: typed only into an idle console with no
 * draft, one per turn, first in first out (spec/behaviour/relay.md §3–§5).
 */

const typed = (text: string) => `<${text}>`;

function harness(
  opts: { limits?: RelayLimits; sessions?: SessionMeta[]; now?: () => number; settleMs?: number } = {},
) {
  const consoles: ConsoleInfo[] = [];
  const writes: Array<{ id: string; data: string }> = [];
  const opens: OpenRequest[] = [];
  const rows: StatusInput[] = [];
  const cleared: string[] = [];
  const broadcasts: ServerMessage[] = [];
  const sessions = opts.sessions ?? [];
  const callsigns = createCallsignBook({ read: async () => ({}), write: async () => undefined });

  const claude = { id: "claude", relayInput: typed } as unknown as AgentAdapter;
  const cursor = { id: "cursor" } as unknown as AgentAdapter;

  let next = 0;
  const addConsole = (extra: Partial<ConsoleInfo> = {}): ConsoleInfo => {
    const id = `c${++next}`;
    const key = extra.sessionId ?? id;
    const info: ConsoleInfo = {
      id,
      kind: "agent",
      projectPath: "/workspace/proj",
      providerId: "claude",
      title: "claude · proj",
      startedAt: "",
      status: "running",
      activity: "idle",
      hooked: true,
      callsign: callsigns.assign(key, extra.sessionId !== undefined),
      ...extra,
    };
    consoles.push(info);
    return info;
  };

  const relay = createRelay({
    consoles: {
      list: () => consoles.map((c) => ({ ...c })),
      input: (id, data) => {
        writes.push({ id, data });
        return { ok: true };
      },
      open: async (request): Promise<OpenResult> => {
        opens.push(request);
        const info = addConsole({ sessionId: request.sessionId!, activity: "unknown" });
        return { ok: true, console: info, attached: false };
      },
      setPending: (id, count) => {
        const info = consoles.find((c) => c.id === id);
        if (info === undefined) return;
        if (count > 0) info.pendingRelays = count;
        else delete info.pendingRelays;
      },
    },
    callsigns,
    sessions: () => sessions,
    space: {
      status: (row) => rows.push(row),
      clear: (_service, key) => cleared.push(key ?? "*"),
    },
    broadcast: (m) => broadcasts.push(m),
    getAdapter: (id) => (id === "claude" ? claude : id === "cursor" ? cursor : undefined),
    turnTimeoutMs: 60_000,
    settleMs: opts.settleMs ?? 0,
    ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  const setActivity = (info: ConsoleInfo, activity: ConsoleActivity) => {
    consoles.find((c) => c.id === info.id)!.activity = activity;
    relay.onActivity(info.id, activity);
  };

  return { relay, consoles, writes, opens, rows, cleared, broadcasts, callsigns, addConsole, setActivity };
}

const operator = { kind: "operator" } as const;

describe("relay", () => {
  it("types into an idle console at once", async () => {
    const h = harness();
    const linda = h.addConsole();
    const outcome = await h.relay.relay({ to: "linda", text: "build it", from: operator });
    assert.deepEqual(outcome, { state: "delivered", to: "Linda" });
    assert.deepEqual(h.writes, [{ id: linda.id, data: "<build it>" }]);
    const delivered = h.rows.find((r) => r.key === "delivered")!;
    assert.equal(delivered.outcome, "ok");
    assert.equal(delivered.label, "relaying to linda...");
    assert.equal(delivered.action, "console:relay");
    assert.equal(delivered.detail, "linda · build it");
  });

  it("queues behind work and delivers one per idle, in order", async () => {
    const h = harness();
    const linda = h.addConsole({ activity: "working" });
    assert.equal((await h.relay.relay({ to: "Linda", text: "one", from: operator })).state, "queued");
    assert.equal((await h.relay.relay({ to: "Linda", text: "two", from: operator })).state, "queued");
    assert.equal(h.writes.length, 0);
    assert.equal(h.consoles[0]!.pendingRelays, 2);

    h.setActivity(linda, "idle");
    assert.deepEqual(h.writes.map((w) => w.data), ["<one>"]);
    // Still idle, but the turn for "one" has not started: nothing more.
    h.relay.onActivity(linda.id, "idle");
    assert.equal(h.writes.length, 1);

    h.setActivity(linda, "working");
    h.setActivity(linda, "idle");
    assert.deepEqual(h.writes.map((w) => w.data), ["<one>", "<two>"]);
    assert.equal(h.consoles[0]!.pendingRelays, undefined);
    assert.ok(h.cleared.includes("linda"));
  });

  it("never types into a console waiting on the operator", async () => {
    const h = harness();
    const linda = h.addConsole({ activity: "waiting" });
    await h.relay.relay({ to: "linda", text: "go", from: operator });
    h.setActivity(linda, "unknown");
    assert.equal(h.writes.length, 0);
    h.setActivity(linda, "idle");
    assert.equal(h.writes.length, 1);
  });

  it("holds while the operator has a draft, and goes once it is cleared", async () => {
    const h = harness();
    const linda = h.addConsole();
    h.relay.noteInput(linda.id, "half a th");
    assert.equal((await h.relay.relay({ to: "linda", text: "go", from: operator })).state, "queued");
    assert.equal(h.writes.length, 0);
    const blocked = h.rows.filter((r) => r.mode === "state").at(-1)!;
    assert.equal(blocked.outcome, "blocked");
    assert.equal(blocked.detail, "operator draft in the prompt");

    h.relay.noteInput(linda.id, "\x03");
    assert.equal(h.writes.length, 1);
  });

  it("wakes a dormant session and delivers on its first idle", async () => {
    const session: SessionMeta = {
      id: "sess-1",
      adapterId: "claude",
      projectDir: "/workspace/proj",
      status: "dormant",
      createdAt: "",
      lastActiveAt: "",
      totalCostUsd: 0,
    };
    const h = harness({ sessions: [session] });
    h.callsigns.assign("sess-1", true);
    const outcome = await h.relay.relay({ to: "linda", text: "wake up", from: operator });
    assert.deepEqual(outcome, { state: "waking", to: "Linda" });
    assert.equal(h.opens[0]!.resume, true);
    assert.equal(h.opens[0]!.sessionId, "sess-1");
    assert.equal(h.writes.length, 0);
    h.setActivity(h.consoles[0]!, "idle");
    assert.deepEqual(h.writes.map((w) => w.data), ["<wake up>"]);
  });

  it("refuses an unknown callsign, a CLI that cannot take relays, and a loop run", async () => {
    const loop: SessionMeta = {
      id: "loop-1",
      adapterId: "claude",
      projectDir: "/workspace/proj",
      status: "dormant",
      createdAt: "",
      lastActiveAt: "",
      totalCostUsd: 0,
      origin: "loop",
    };
    const h = harness({ sessions: [loop] });
    h.callsigns.assign("loop-1", true);
    h.addConsole({ providerId: "cursor" });

    const unknown = await h.relay.relay({ to: "nobody", text: "x", from: operator });
    assert.equal(unknown.state, "refused");
    assert.equal(unknown.reason, "no agent called nobody");

    const cursor = await h.relay.relay({ to: "bob", text: "x", from: operator });
    assert.equal(cursor.reason, "cursor cannot take relayed prompts");

    const looped = await h.relay.relay({ to: "linda", text: "x", from: operator });
    assert.equal(looped.reason, "Linda is a live loop run");
    assert.ok(h.rows.filter((r) => r.outcome === "failed").length >= 3);
    assert.equal(h.writes.length, 0);
  });

  it("drops a queue when its console exits, reporting each relay", async () => {
    const h = harness();
    const linda = h.addConsole({ activity: "working" });
    await h.relay.relay({ to: "linda", text: "a", from: operator });
    await h.relay.relay({ to: "linda", text: "b", from: operator });
    h.relay.onExit(linda.id);
    assert.equal(h.rows.filter((r) => r.key === "dropped").length, 2);
    h.setActivity(linda, "idle");
    assert.equal(h.writes.length, 0);
  });

  it("frames an agent's relay and refuses one to itself or to a dormant session", async () => {
    const session: SessionMeta = {
      id: "sess-z",
      adapterId: "claude",
      projectDir: "/workspace/proj",
      status: "dormant",
      createdAt: "",
      lastActiveAt: "",
      totalCostUsd: 0,
    };
    const h = harness({ sessions: [session] });
    const linda = h.addConsole();
    const bob = h.addConsole();
    h.callsigns.assign("sess-z", true);
    const fromBob = { kind: "agent", consoleId: bob.id, callsign: "Bob" } as const;

    assert.equal((await h.relay.relay({ to: "linda", text: "hi", from: fromBob })).state, "delivered");
    assert.deepEqual(h.writes, [{ id: linda.id, data: "<[from Bob] hi>" }]);
    assert.equal(h.rows.find((r) => r.key === "delivered")!.detail, "bob→linda · hi");
    assert.equal(h.rows.find((r) => r.key === "delivered")!.action, "agent:relay");

    assert.equal((await h.relay.relay({ to: "bob", text: "me", from: fromBob })).state, "refused");
    const dormant = await h.relay.relay({ to: "alice", text: "wake", from: fromBob });
    assert.equal(dormant.state, "refused");
    assert.equal(h.opens.length, 0);
  });

  it("holds an agent past its cooldown or rate until the operator releases it", async () => {
    let clock = 0;
    const h = harness({
      limits: { rateMax: 2, windowMs: 1_000, cooldownMs: 100 },
      now: () => clock,
    });
    const linda = h.addConsole();
    const bob = h.addConsole();
    const ann = h.addConsole();
    const fromBob = { kind: "agent", consoleId: bob.id, callsign: "Bob" } as const;

    await h.relay.relay({ to: "linda", text: "1", from: fromBob });
    const cooled = await h.relay.relay({ to: "linda", text: "2", from: fromBob });
    assert.equal(cooled.state, "held");
    const frame = h.broadcasts.at(-1) as Extract<ServerMessage, { type: "relay.held" }>;
    assert.equal(frame.held.length, 1);
    assert.equal(frame.held[0]!.from, "Bob");

    clock = 500;
    await h.relay.relay({ to: "alice", text: "3", from: fromBob });
    const rated = await h.relay.relay({ to: "alice", text: "4", from: fromBob });
    assert.equal(rated.state, "held");
    assert.equal(h.relay.held().length, 2);

    const [first, second] = h.relay.held();
    const released = await h.relay.release(first!.id, true);
    assert.equal(released?.state, "queued");
    h.setActivity(linda, "working");
    h.setActivity(linda, "idle");
    assert.ok(h.writes.some((w) => w.id === linda.id && w.data === "<[from Bob] 2>"));

    await h.relay.release(second!.id, false);
    assert.equal(h.relay.held().length, 0);
    assert.ok(!h.writes.some((w) => w.id === ann.id && w.data.includes("4")));
  });

  it("lists running agents and dormant named sessions in the roster", async () => {
    const session: SessionMeta = {
      id: "sess-d",
      adapterId: "claude",
      projectDir: "/workspace/other",
      name: "fix the parser",
      status: "dormant",
      createdAt: "",
      lastActiveAt: "",
      totalCostUsd: 0,
    };
    const h = harness({ sessions: [session] });
    h.addConsole({ activity: "working" });
    h.callsigns.assign("sess-d", true);
    assert.deepEqual(h.relay.roster(), [
      { callsign: "Linda", project: "proj", activity: "working", running: true },
      { callsign: "Bob", project: "other", activity: "dormant", running: false, title: "fix the parser" },
    ]);
  });
});

describe("relay settling", () => {
  it("waits for a freshly idle console to settle before typing", async () => {
    const h = harness({ settleMs: 30 });
    const linda = h.addConsole({ activity: "unknown" });
    await h.relay.relay({ to: "linda", text: "go", from: { kind: "operator" } });
    h.setActivity(linda, "idle");
    assert.equal(h.writes.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(h.writes.map((w) => w.data), ["<go>"]);
    h.relay.dispose();
  });

  it("does not type when work resumes before it settles", async () => {
    const h = harness({ settleMs: 30 });
    const linda = h.addConsole({ activity: "working" });
    await h.relay.relay({ to: "linda", text: "go", from: { kind: "operator" } });
    h.setActivity(linda, "idle");
    h.setActivity(linda, "working");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(h.writes.length, 0);
    h.relay.dispose();
  });
});

describe("draft estimate", () => {
  it("counts typing, backspace, and clears on Enter, Ctrl+C and Ctrl+U", () => {
    assert.equal(nextDraft(0, "abc"), 3);
    assert.equal(nextDraft(3, "\x7f"), 2);
    assert.equal(nextDraft(3, "\r"), 0);
    assert.equal(nextDraft(3, "\x03"), 0);
    assert.equal(nextDraft(3, "\x15"), 0);
    assert.equal(nextDraft(0, "x\ry"), 1);
  });

  it("ignores escape sequences — arrows, focus, mouse, paste markers", () => {
    assert.equal(nextDraft(0, "\x1b[A\x1b[B\x1b[I\x1b[O"), 0);
    assert.equal(nextDraft(0, "\x1b[<0;10;5M"), 0);
    assert.equal(nextDraft(0, "\x1b[200~hi\x1b[201~"), 2);
    assert.equal(nextDraft(0, "\x1bOP"), 0);
  });
});
