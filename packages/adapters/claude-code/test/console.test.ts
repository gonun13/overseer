import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ConsoleExit } from "@overseer/protocol";
import {
  openConsole,
  setConsoleSpawner,
  type PtyProcess,
} from "../src/console.js";

/**
 * Fake PTY — exercises spawn options, I/O, resize, exit, and idempotent kill
 * without loading node-pty.
 */

function fakePty(): {
  proc: PtyProcess;
  emitData: (data: string) => void;
  emitExit: (exitCode: number, signal?: number) => void;
  writes: string[];
  resizes: Array<{ cols: number; rows: number }>;
  kills: string[];
  spawnOpts: {
    file: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: NodeJS.ProcessEnv;
  } | null;
} {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const kills: string[] = [];
  let dataListener: ((data: string) => void) | undefined;
  let exitListener:
    | ((event: { exitCode: number; signal?: number }) => void)
    | undefined;
  let spawnOpts: {
    file: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: NodeJS.ProcessEnv;
  } | null = null;

  const proc: PtyProcess = {
    pid: 4242,
    write(data) {
      writes.push(data);
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    kill(signal = "SIGTERM") {
      kills.push(signal);
    },
    onData(listener) {
      dataListener = listener;
    },
    onExit(listener) {
      exitListener = listener;
    },
  };

  setConsoleSpawner((opts) => {
    spawnOpts = opts;
    return proc;
  });

  return {
    proc,
    emitData: (data) => dataListener?.(data),
    emitExit: (exitCode, signal = 0) =>
      exitListener?.({ exitCode, signal }),
    writes,
    resizes,
    kills,
    get spawnOpts() {
      return spawnOpts;
    },
  };
}

afterEach(() => {
  setConsoleSpawner(undefined);
});

describe("openConsole", () => {
  it("spawns claude in the given cwd with the requested size", async () => {
    const fake = fakePty();
    const handle = await openConsole({
      cwd: "/workspace/demo",
      cols: 120,
      rows: 40,
    });

    assert.equal(fake.spawnOpts?.file, "claude");
    assert.deepEqual(fake.spawnOpts?.args, []);
    assert.equal(fake.spawnOpts?.cwd, "/workspace/demo");
    assert.equal(fake.spawnOpts?.cols, 120);
    assert.equal(fake.spawnOpts?.rows, 40);
    assert.equal(fake.spawnOpts?.env.TERM, "xterm-256color");

    handle.kill();
    fake.emitExit(0);
    await handle.done;
  });

  it("forwards data and resize, and settles on exit", async () => {
    const fake = fakePty();
    const handle = await openConsole({
      cwd: "/workspace/demo",
      cols: 80,
      rows: 24,
    });

    const chunks: string[] = [];
    const exits: ConsoleExit[] = [];
    handle.onData((data) => chunks.push(data));
    handle.onExit((info) => exits.push(info));

    fake.emitData("hello");
    handle.write("hi\r");
    handle.resize(100, 30);
    fake.emitExit(0);

    assert.deepEqual(chunks, ["hello"]);
    assert.deepEqual(fake.writes, ["hi\r"]);
    assert.deepEqual(fake.resizes, [{ cols: 100, rows: 30 }]);
    assert.deepEqual(exits, [{ exitCode: 0 }]);
    assert.deepEqual(await handle.done, { exitCode: 0 });
  });

  it("kill is idempotent and records a signal when present", async () => {
    const fake = fakePty();
    const handle = await openConsole({
      cwd: "/workspace/demo",
      cols: 80,
      rows: 24,
    });

    handle.kill();
    handle.kill();
    assert.deepEqual(fake.kills, ["SIGTERM"]);

    fake.emitExit(1, 15);
    const info = await handle.done;
    assert.equal(info.exitCode, 1);
    assert.equal(info.signal, 15);

    handle.kill();
    assert.deepEqual(fake.kills, ["SIGTERM"]);
  });
});
