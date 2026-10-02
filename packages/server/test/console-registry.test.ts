import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdapterStatus,
  AgentAdapter,
  ConsoleExit,
  ServerMessage,
} from "@overseer/protocol";
import {
  createConsoleRegistry,
  type ConsoleRegistryDeps,
  type OpenRequest,
} from "../src/console-registry.js";
import type { PtyHandle, PtySpawnOpts } from "../src/pty.js";

/**
 * Console registry against a fake PTY and adapter — consoles outlive sockets,
 * replay scrollback on attach, and never put two CLIs on one session.
 */

interface FakePty {
  opts: PtySpawnOpts;
  writes: string[];
  resizes: Array<[number, number]>;
  kills: number;
  emitData(data: string): void;
  emitExit(info: ConsoleExit): void;
}

function harness(overrides: Partial<ConsoleRegistryDeps> = {}) {
  const broadcasts: ServerMessage[] = [];
  const ptys: FakePty[] = [];
  const status: AdapterStatus = { authenticated: true };
  let minted = 0;
  const hookUrls: string[] = [];

  const adapter = {
    id: "claude-code",
    getStatus: async () => status,
    consoleCommand: async (opts: { cwd: string; sessionId?: string; resume?: boolean; hookUrl?: string }) => {
      if (opts.hookUrl !== undefined) hookUrls.push(opts.hookUrl);
      return {
      file: "claude",
      args:
        opts.sessionId === undefined
          ? []
          : [opts.resume === true ? "--resume" : "--session-id", opts.sessionId],
      cwd: opts.cwd,
      hooked: opts.hookUrl !== undefined,
      };
    },
    sessions: { mintSessionId: () => `minted-${++minted}` },
  } as unknown as AgentAdapter;

  const spawn = async (opts: PtySpawnOpts): Promise<PtyHandle> => {
    const data = new Set<(d: string) => void>();
    const exits = new Set<(i: ConsoleExit) => void>();
    let exited: ConsoleExit | undefined;
    const fake: FakePty = {
      opts,
      writes: [],
      resizes: [],
      kills: 0,
      emitData: (d) => data.forEach((l) => l(d)),
      emitExit: (i) => {
        if (exited !== undefined) return;
        exited = i;
        exits.forEach((l) => l(i));
      },
    };
    ptys.push(fake);
    return {
      pid: 1000 + ptys.length,
      onData: (l) => data.add(l),
      onExit: (l) => {
        exits.add(l);
        if (exited !== undefined) l(exited);
      },
      write: (d) => fake.writes.push(d),
      resize: (c, r) => fake.resizes.push([c, r]),
      kill: () => {
        fake.kills += 1;
        fake.emitExit({ exitCode: 0, signal: 15 });
      },
      done: Promise.resolve({ exitCode: 0 }),
    };
  };

  const registry = createConsoleRegistry({
    broadcast: (m) => broadcasts.push(m),
    hookBase: "http://127.0.0.1:3000",
    getAdapter: (id) => (id === "claude-code" ? adapter : undefined),
    isInsideWorkspace: async (p) => p.startsWith("/workspace/"),
    recordAction: async () => undefined,
    loopSessionIndex: async () => new Map(),
    noteProviderSignedOut: async () => undefined,
    spawn,
    shell: () => ({ file: "bash", args: ["-l"] }),
    loop: (name) => ({ file: "/app/loop/run", args: [name], cwd: "/app" }),
    quietMs: 10,
    ...overrides,
  });

  const sink = () => {
    const frames: ServerMessage[] = [];
    const send = (m: ServerMessage) => frames.push(m);
    return { frames, send };
  };

  return { registry, broadcasts, ptys, status, sink, hookUrls };
}

const agent = (extra: Partial<OpenRequest> = {}): OpenRequest => ({
  kind: "agent",
  projectPath: "/workspace/a",
  providerId: "claude-code",
  cols: 80,
  rows: 24,
  ...extra,
});

describe("console registry", () => {
  it("runs several consoles across projects at once", async () => {
    const { registry, ptys } = harness();
    const a = await registry.open(agent());
    const b = await registry.open(agent({ projectPath: "/workspace/b" }));
    const c = await registry.open({ ...agent(), kind: "shell" });
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(registry.list().length, 3);
    assert.equal(ptys[1]!.opts.cwd, "/workspace/b");
    assert.equal(ptys[2]!.opts.file, "bash");
  });

  it("mints a session id for a new agent console and wires hooks", async () => {
    const { registry, ptys } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    assert.equal(result.console.sessionId, "minted-1");
    assert.equal(result.console.hooked, true);
    assert.deepEqual(ptys[0]!.opts.args, ["--session-id", "minted-1"]);
  });

  it("replays scrollback on attach and streams to every attached socket", async () => {
    const { registry, ptys, sink } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    const id = result.console.id;
    const first = sink();
    registry.attach(id, first.send, 80, 24);
    ptys[0]!.emitData("hello ");
    const second = sink();
    registry.attach(id, second.send, 100, 30);
    ptys[0]!.emitData("world");

    assert.deepEqual(second.frames[0], { type: "console.replay", id, data: "hello " });
    assert.deepEqual(ptys[0]!.resizes.at(-1), [100, 30]);
    const outputs = (frames: ServerMessage[]) =>
      frames.filter((f) => f.type === "console.output").map((f) => (f as { data: string }).data);
    assert.deepEqual(outputs(first.frames), ["hello ", "world"]);
    assert.deepEqual(outputs(second.frames), ["world"]);
  });

  it("keeps the process alive when a socket goes away", async () => {
    const { registry, ptys, sink } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    const tab = sink();
    registry.attach(result.console.id, tab.send, 80, 24);
    registry.detachAll(tab.send);
    ptys[0]!.emitData("still here");
    assert.equal(ptys[0]!.kills, 0);
    assert.equal(tab.frames.filter((f) => f.type === "console.output").length, 0);

    const again = sink();
    registry.attach(result.console.id, again.send, 80, 24);
    assert.deepEqual(again.frames[0], {
      type: "console.replay",
      id: result.console.id,
      data: "still here",
    });
  });

  it("trims scrollback from the front", async () => {
    const { registry, ptys, sink } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    const chunk = "x".repeat(200 * 1024);
    ptys[0]!.emitData("head");
    ptys[0]!.emitData(chunk);
    ptys[0]!.emitData(chunk);
    ptys[0]!.emitData(chunk);
    const tab = sink();
    registry.attach(result.console.id, tab.send, 80, 24);
    const replay = tab.frames[0] as { data: string };
    assert.ok(replay.data.length <= 512 * 1024);
    assert.ok(!replay.data.startsWith("head"));
  });

  it("attaches to the console already running a session instead of starting another", async () => {
    const { registry, ptys } = harness();
    const first = await registry.open(agent({ sessionId: "s1", resume: true }));
    const second = await registry.open(agent({ sessionId: "s1", resume: true }));
    assert.ok(first.ok && second.ok);
    assert.equal(second.attached, true);
    assert.equal(second.console.id, first.console.id);
    assert.equal(ptys.length, 1);
    assert.deepEqual(ptys[0]!.opts.args, ["--resume", "s1"]);
    assert.equal(registry.findBySession("s1")?.id, first.console.id);
  });

  it("refuses to resume a session a live loop run owns", async () => {
    const { registry } = harness({
      loopSessionIndex: async () =>
        new Map([["s1", { slug: "a", pid: 1, sessionId: "s1" } as never]]),
    });
    const result = await registry.open(agent({ sessionId: "s1", resume: true }));
    assert.equal(result.ok, false);
  });

  it("refuses a signed-out provider and a path outside the workspace", async () => {
    const h = harness();
    h.status.authenticated = false;
    assert.equal((await h.registry.open(agent())).ok, false);
    assert.equal((await h.registry.open(agent({ projectPath: "/etc" }))).ok, false);
  });

  it("keeps an exited console listed until dismissed", async () => {
    const { registry, ptys, sink, broadcasts } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    ptys[0]!.emitExit({ exitCode: 3 });
    assert.equal(registry.list()[0]!.status, "exited");
    assert.equal(registry.list()[0]!.exitCode, 3);

    const late = sink();
    registry.attach(result.console.id, late.send, 80, 24);
    assert.equal(late.frames.at(-1)!.type, "console.exit");

    registry.dismiss(result.console.id);
    assert.equal(registry.list().length, 0);
    assert.equal(broadcasts.at(-1)!.type, "console.list");
  });

  it("kill ends the process but leaves it listed", async () => {
    const { registry, ptys } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    registry.kill(result.console.id);
    registry.kill(result.console.id);
    assert.equal(ptys[0]!.kills, 2);
    assert.equal(registry.list()[0]!.status, "exited");
  });

  it("takes activity from hooks only with the console's own token", async () => {
    const { registry, broadcasts, hookUrls } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    const [, id, token] = /\/hooks\/([^/]+)\/([0-9a-f]+)$/.exec(hookUrls[0]!)!;
    assert.equal(id, result.console.id);

    assert.equal(registry.reportHook(id!, "wrong", "waiting"), false);
    assert.equal(registry.reportHook(id!, token!, "bogus"), false);
    assert.equal(registry.list()[0]!.activity, "unknown");

    assert.equal(registry.reportHook(id!, token!, "waiting"), true);
    assert.equal(registry.list()[0]!.activity, "waiting");
    assert.deepEqual(broadcasts.at(-1), { type: "console.state", id, activity: "waiting" });
  });

  it("ignores output for activity once hooks are wired", async () => {
    const { registry, ptys } = harness();
    const result = await registry.open(agent());
    assert.ok(result.ok);
    ptys[0]!.emitData("spinner frame");
    assert.equal(registry.list()[0]!.activity, "unknown");
  });

  it("guesses activity from output when the CLI has no hooks", async () => {
    const { registry, ptys } = harness({ hookBase: undefined });
    const result = await registry.open(agent());
    assert.ok(result.ok);
    assert.equal(result.console.hooked, false);
    ptys[0]!.emitData("thinking…");
    assert.equal(registry.list()[0]!.activity, "working");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(registry.list()[0]!.activity, "idle");
  });

  it("attaches to a project's running loop rather than starting a second", async () => {
    const { registry, ptys } = harness();
    const loop = { ...agent(), kind: "loop" as const };
    const first = await registry.open(loop);
    const second = await registry.open(loop);
    assert.ok(first.ok && second.ok);
    assert.equal(second.attached, true);
    assert.equal(ptys.length, 1);
    assert.deepEqual(ptys[0]!.opts.args, ["a"]);
  });
});
