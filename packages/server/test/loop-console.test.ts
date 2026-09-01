import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ConsoleExit } from "@overseer/protocol";
import {
  openLoopConsole,
  setLoopConsoleSpawner,
  type PtyProcess,
} from "../src/loop-console.js";

/**
 * Fake PTY — exercises spawn options, I/O, resize, exit, and idempotent kill
 * without loading node-pty. Mirrors adapters/claude-code/test/console.test.ts.
 */

function fakePty(): {
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

  setLoopConsoleSpawner((opts) => {
    spawnOpts = opts;
    return proc;
  });

  return {
    emitData: (data) => dataListener?.(data),
    emitExit: (exitCode, signal = 0) => exitListener?.({ exitCode, signal }),
    writes,
    resizes,
    kills,
    get spawnOpts() {
      return spawnOpts;
    },
  };
}

afterEach(() => {
  setLoopConsoleSpawner(undefined);
});

describe("openLoopConsole", () => {
  it("spawns loop/run with the workspace name and the requested size", async () => {
    const fake = fakePty();
    const handle = await openLoopConsole({
      name: "demo",
      cols: 120,
      rows: 40,
    });

    assert.equal(fake.spawnOpts?.file, "/app/loop/run");
    assert.deepEqual(fake.spawnOpts?.args, ["demo"]);
    assert.equal(fake.spawnOpts?.cwd, "/app");
    assert.equal(fake.spawnOpts?.cols, 120);
    assert.equal(fake.spawnOpts?.rows, 40);

    handle.kill();
    fake.emitExit(0);
    await handle.done;
  });

  it("forwards data and resize, and settles on exit", async () => {
    const fake = fakePty();
    const handle = await openLoopConsole({ name: "demo", cols: 80, rows: 24 });

    const chunks: string[] = [];
    const exits: ConsoleExit[] = [];
    handle.onData((data) => chunks.push(data));
    handle.onExit((info) => exits.push(info));

    fake.emitData("overseer session on 'demo'\r\n");
    handle.write("hi\r");
    handle.resize(100, 30);
    fake.emitExit(0);

    assert.deepEqual(chunks, ["overseer session on 'demo'\r\n"]);
    assert.deepEqual(fake.writes, ["hi\r"]);
    assert.deepEqual(fake.resizes, [{ cols: 100, rows: 30 }]);
    assert.deepEqual(exits, [{ exitCode: 0 }]);
    assert.deepEqual(await handle.done, { exitCode: 0 });
  });

  it("kill is idempotent and records a signal when present", async () => {
    const fake = fakePty();
    const handle = await openLoopConsole({ name: "demo", cols: 80, rows: 24 });

    handle.kill();
    handle.kill();
    assert.deepEqual(fake.kills, ["SIGTERM"]);

    fake.emitExit(5, 15);
    const info = await handle.done;
    assert.equal(info.exitCode, 5);
    assert.equal(info.signal, 15);

    handle.kill();
    assert.deepEqual(fake.kills, ["SIGTERM"]);
  });
});
