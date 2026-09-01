import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
  AgentAdapter,
  ConsoleExit,
  ConsoleHandle,
  ServerMessage,
} from "@overseer/protocol";
import { createConsoleSession } from "../src/console.js";
import {
  setLoopConsoleSpawner,
  type PtyProcess as LoopPtyProcess,
} from "../src/loop-console.js";
import type { WorldSnapshot } from "../src/memory/internal.js";

/**
 * Console broker against injected adapter/PTY fakes — covers auth/project
 * guards, socket ownership, stale ids, and every cleanup path.
 */

function recorder() {
  const frames: ServerMessage[] = [];
  const send = (frame: ServerMessage) => frames.push(frame);
  const ofType = <T extends ServerMessage["type"]>(type: T) =>
    frames.filter(
      (f): f is Extract<ServerMessage, { type: T }> => f.type === type,
    );
  return { frames, send, ofType };
}

function fakeHandle(): {
  handle: ConsoleHandle;
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  kills: number;
  emitData: (data: string) => void;
  emitExit: (info: ConsoleExit) => void;
} {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let kills = 0;
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(info: ConsoleExit) => void>();
  let exited = false;
  let exitInfo: ConsoleExit = { exitCode: -1 };
  let settle!: (info: ConsoleExit) => void;
  const done = new Promise<ConsoleExit>((resolve) => {
    settle = resolve;
  });

  const finish = (info: ConsoleExit) => {
    if (exited) return;
    exited = true;
    exitInfo = info;
    for (const listener of exitListeners) listener(info);
    settle(info);
  };

  return {
    writes,
    resizes,
    get kills() {
      return kills;
    },
    emitData: (data) => {
      for (const listener of dataListeners) listener(data);
    },
    emitExit: finish,
    handle: {
      onData(listener) {
        dataListeners.add(listener);
      },
      onExit(listener) {
        exitListeners.add(listener);
        if (exited) listener(exitInfo);
      },
      write(data) {
        writes.push(data);
      },
      resize(cols, rows) {
        resizes.push({ cols, rows });
      },
      kill() {
        kills += 1;
        finish({ exitCode: -1, signal: 15 });
      },
      done,
    },
  };
}

function baseSnapshot(
  overrides: Partial<WorldSnapshot> = {},
): WorldSnapshot {
  return {
    at: new Date().toISOString(),
    runCount: 1,
    workspaceRoot: "/workspace",
    projects: [
      {
        name: "demo",
        path: "/workspace/demo",
        gitBranch: "main",
        dirty: false,
      },
    ],
    providers: [
      { id: "claude-code", status: { authenticated: true }, login: true },
    ],
    last_active_project: "/workspace/demo",
    attached_provider: "claude-code",
    ...overrides,
  };
}

function makeAdapter(opts: {
  authenticated?: boolean;
  openConsole?: AgentAdapter["openConsole"];
}): AgentAdapter {
  return {
    id: "claude-code",
    capabilities: {
      streamingDeltas: true,
      permissionPrompts: true,
      interrupt: true,
      subagents: true,
      mcp: true,
      skills: true,
      effortLevels: true,
      costReporting: true,
      checkpoints: false,
      backgroundAgents: false,
      login: true,
    },
    createSession: async () => {
      throw new Error("unused");
    },
    resumeSession: async () => {
      throw new Error("unused");
    },
    listSessions: async () => [],
    getStatus: async () => ({
      authenticated: opts.authenticated ?? true,
    }),
    openConsole: opts.openConsole,
  };
}

function fakeLoopPty(): {
  spawnArgs: { file: string; args: string[] } | null;
  emitExit: (exitCode: number) => void;
} {
  let spawnArgs: { file: string; args: string[] } | null = null;
  let exitListener:
    | ((event: { exitCode: number; signal?: number }) => void)
    | undefined;
  const proc: LoopPtyProcess = {
    pid: 1234,
    write() {},
    resize() {},
    kill() {},
    onData() {},
    onExit(listener) {
      exitListener = listener;
    },
  };
  setLoopConsoleSpawner((opts) => {
    spawnArgs = { file: opts.file, args: opts.args };
    return proc;
  });
  return {
    get spawnArgs() {
      return spawnArgs;
    },
    emitExit: (exitCode) => exitListener?.({ exitCode }),
  };
}

afterEach(() => {
  setLoopConsoleSpawner(undefined);
});

describe("createConsoleSession", () => {
  it("refuses when no provider is attached", async () => {
    const { send, frames } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () =>
        baseSnapshot({ attached_provider: undefined }),
      isInsideWorkspace: async () => true,
      getAdapter: () => undefined,
      recordAction: async () => {},
    });
    const result = await session.open(80, 24);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no provider attached/);
    assert.equal(frames.length, 0);
  });

  it("refuses when the provider is not signed in", async () => {
    const { send } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () => makeAdapter({ authenticated: false }),
      recordAction: async () => {},
    });
    const result = await session.open(80, 24);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not signed in/);
  });

  it("refuses a project outside the workspace", async () => {
    const { send } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => false,
      getAdapter: () => makeAdapter({ authenticated: true }),
      recordAction: async () => {},
    });
    const result = await session.open(80, 24);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not inside the workspace/);
  });

  it("opens, forwards I/O, rejects stale ids, and reports exit", async () => {
    const fake = fakeHandle();
    let openedCwd: string | undefined;
    const { send, ofType } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        makeAdapter({
          openConsole: async (opts) => {
            openedCwd = opts.cwd;
            return fake.handle;
          },
        }),
      recordAction: async () => {},
    });

    assert.equal((await session.open(80, 24)).ok, true);
    assert.equal(openedCwd, "/workspace/demo");
    const opened = ofType("console.opened");
    assert.equal(opened.length, 1);
    const id = opened[0]!.id;

    fake.emitData("welcome\r\n");
    assert.equal(ofType("console.output")[0]?.data, "welcome\r\n");

    assert.equal(session.input(id, "hi").ok, true);
    assert.deepEqual(fake.writes, ["hi"]);
    assert.equal(session.resize(id, 100, 30).ok, true);
    assert.deepEqual(fake.resizes, [{ cols: 100, rows: 30 }]);
    assert.equal(session.input("stale", "x").ok, false);

    fake.emitExit({ exitCode: 0 });
    const exits = ofType("console.exit");
    assert.equal(exits.length, 1);
    assert.equal(exits[0]!.id, id);
    assert.equal(exits[0]!.exitCode, 0);

    // After exit, the slot is free; close is idempotent.
    assert.equal(session.close(id).ok, true);
  });

  it("dispose and close terminate the live PTY", async () => {
    const fake = fakeHandle();
    const { send, ofType } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        makeAdapter({
          openConsole: async () => fake.handle,
        }),
      recordAction: async () => {},
    });

    assert.equal((await session.open(80, 24)).ok, true);
    const id = ofType("console.opened")[0]!.id;
    assert.equal(session.close(id).ok, true);
    assert.equal(fake.kills, 1);
    assert.equal(session.input(id, "x").ok, false);

    // Re-open then dispose via socket teardown.
    const fake2 = fakeHandle();
    const session2 = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        makeAdapter({
          openConsole: async () => fake2.handle,
        }),
      recordAction: async () => {},
    });
    assert.equal((await session2.open(80, 24)).ok, true);
    session2.dispose();
    assert.equal(fake2.kills, 1);
  });

  it("a loop console opens alongside the CLI console, killing neither", async () => {
    const cli = fakeHandle();
    const loop = fakeLoopPty();
    const { send, ofType } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () => makeAdapter({ openConsole: async () => cli.handle }),
      recordAction: async () => {},
    });

    assert.equal((await session.open(80, 24)).ok, true);
    const cliId = ofType("console.opened")[0]!.id;
    assert.equal((await session.open(80, 24, "loop")).ok, true);

    // The CLI console survives the loop opening on the other slot.
    assert.equal(cli.kills, 0);
    assert.deepEqual(loop.spawnArgs, { file: "/app/loop/run", args: ["demo"] });

    const acks = ofType("console.opened");
    assert.equal(acks.length, 2);
    const loopAck = acks[1]!;
    assert.equal(loopAck.mode, "loop");
    assert.equal(acks[0]!.mode, undefined);
    assert.notEqual(cliId, loopAck.id);

    // Both remain addressable by their own ids.
    assert.equal(session.input(cliId, "a").ok, true);
    assert.deepEqual(cli.writes, ["a"]);
    assert.equal(session.input(loopAck.id, "b").ok, true);

    // Closing the loop leaves the CLI console alone.
    assert.equal(session.close(loopAck.id).ok, true);
    // Settle the killed PTY so its SIGKILL grace timer does not outlive the test.
    loop.emitExit(0);
    assert.equal(cli.kills, 0);
    assert.equal(session.input(cliId, "c").ok, true);
  });

  it("dispose tears down both slots", async () => {
    const cli = fakeHandle();
    const loop = fakeLoopPty();
    const { send } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () => makeAdapter({ openConsole: async () => cli.handle }),
      recordAction: async () => {},
    });

    assert.equal((await session.open(80, 24)).ok, true);
    assert.equal((await session.open(80, 24, "loop")).ok, true);
    session.dispose();
    loop.emitExit(0);
    assert.equal(cli.kills, 1);
  });

  it("a second open in the same slot replaces the first process", async () => {
    const first = fakeHandle();
    const second = fakeHandle();
    let calls = 0;
    const { send, ofType } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () => baseSnapshot(),
      isInsideWorkspace: async () => true,
      getAdapter: () =>
        makeAdapter({
          openConsole: async () => {
            calls += 1;
            return calls === 1 ? first.handle : second.handle;
          },
        }),
      recordAction: async () => {},
    });

    assert.equal((await session.open(80, 24)).ok, true);
    const firstId = ofType("console.opened")[0]!.id;
    assert.equal((await session.open(100, 30)).ok, true);
    assert.equal(first.kills, 1);
    const secondId = ofType("console.opened").at(-1)!.id;
    assert.notEqual(firstId, secondId);
    assert.equal(session.input(firstId, "x").ok, false);
    assert.equal(session.input(secondId, "y").ok, true);
    assert.deepEqual(second.writes, ["y"]);
  });

  it("loop mode skips the attached-provider check and spawns loop/run with the project's basename", async () => {
    const fake = fakeLoopPty();
    const { send, ofType } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () =>
        baseSnapshot({ attached_provider: undefined }),
      isInsideWorkspace: async () => true,
      getAdapter: () => {
        throw new Error("loop mode must not look up an adapter");
      },
      recordAction: async () => {},
    });

    const result = await session.open(80, 24, "loop");
    assert.equal(result.ok, true);
    assert.deepEqual(fake.spawnArgs, { file: "/app/loop/run", args: ["demo"] });
    assert.equal(ofType("console.opened").length, 1);
  });

  it("loop mode still requires an active project inside the workspace", async () => {
    const { send } = recorder();
    const session = createConsoleSession(send, {
      readSnapshot: async () =>
        baseSnapshot({ last_active_project: undefined }),
      isInsideWorkspace: async () => true,
      getAdapter: () => makeAdapter({}),
      recordAction: async () => {},
    });
    const result = await session.open(80, 24, "loop");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no active project/);
  });
});
