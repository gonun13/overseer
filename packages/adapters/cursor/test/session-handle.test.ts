import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { after, describe, it } from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentEvent } from "@overseer/protocol";
import { createSessionHandle, setSessionSpawner } from "../src/session-handle.js";

interface FakeChild {
  child: ChildProcessWithoutNullStreams;
  args: string[];
  cwd: string;
  emit: (line: unknown) => Promise<void>;
  exit: () => void;
  kills: string[];
}

function fakeChild(args: string[], cwd: string): FakeChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kills: string[] = [];
  const child = Object.assign(emitter, {
    // A defined, non-real pid: killProcessGroup's `process.kill(-pid, …)`
    // throws ESRCH against it (no such process group), which is exactly what
    // routes the call to its `child.kill()` fallback — the path this fixture
    // wants to observe.
    pid: 999_999,
    stdout,
    stderr,
    stdin: { writable: true, write: () => true },
    kill: (signal?: string) => {
      kills.push(signal ?? "SIGTERM");
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;

  return {
    child,
    args,
    cwd,
    kills,
    emit: async (line: unknown) => {
      stdout.write(`${JSON.stringify(line)}\n`);
      await new Promise((r) => setImmediate(r));
    },
    exit: () => {
      emitter.emit("exit");
    },
  };
}

/** Each `send` spawns a fresh child — this queue hands one out per call, in
 * order, mirroring the real CLI's spawn-per-turn shape. */
function install(): FakeChild[] {
  const spawned: FakeChild[] = [];
  setSessionSpawner((opts) => {
    const fc = fakeChild(opts.args, opts.cwd);
    spawned.push(fc);
    return fc.child;
  });
  return spawned;
}

after(() => setSessionSpawner(undefined));

async function drain() {
  await new Promise((r) => setImmediate(r));
}

describe("createSessionHandle argv", () => {
  it("always resumes onto the chat id and always passes --trust --force --sandbox disabled", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    handle.send({ role: "user", content: [{ type: "text", text: "hi" }] });
    await drain();

    const [call] = spawned;
    assert.ok(call);
    assert.ok(call.args.includes("--resume"));
    assert.equal(call.args[call.args.indexOf("--resume") + 1], "chat-1");
    assert.ok(call.args.includes("--trust"));
    assert.ok(call.args.includes("--force"));
    assert.deepEqual(
      call.args.slice(call.args.indexOf("--sandbox"), call.args.indexOf("--sandbox") + 2),
      ["--sandbox", "disabled"],
    );
    assert.equal(call.args.at(-1), "hi");
    assert.equal(call.cwd, "/proj");
  });

  it("passes --model only when one is set", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj", model: "composer-2.5" });
    handle.send({ role: "user", content: [{ type: "text", text: "hi" }] });
    await drain();

    assert.ok(spawned[0]?.args.includes("--model"));
    assert.equal(spawned[0]?.args[spawned[0].args.indexOf("--model") + 1], "composer-2.5");
  });

  it("maps plan/ask permission modes onto --mode, and omits the flag for default", async () => {
    const spawnedPlan = install();
    createSessionHandle("c1", { projectDir: "/p", permissionMode: "plan" }).send({
      role: "user",
      content: [{ type: "text", text: "x" }],
    });
    await drain();
    assert.ok(spawnedPlan[0]?.args.includes("--mode"));
    assert.equal(spawnedPlan[0]?.args[spawnedPlan[0].args.indexOf("--mode") + 1], "plan");

    const spawnedDefault = install();
    createSessionHandle("c2", { projectDir: "/p" }).send({
      role: "user",
      content: [{ type: "text", text: "x" }],
    });
    await drain();
    assert.equal(spawnedDefault[0]?.args.includes("--mode"), false);
  });

  it("joins only the text parts of the message, dropping any image part", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    handle.send({
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "image", source: "data:...", mediaType: "image/png" },
        { type: "text", text: "second" },
      ],
    });
    await drain();
    assert.equal(spawned[0]?.args.at(-1), "first\nsecond");
  });
});

describe("createSessionHandle turn queueing", () => {
  it("holds a second send until the first turn's result arrives", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    handle.send({ role: "user", content: [{ type: "text", text: "one" }] });
    await drain();
    handle.send({ role: "user", content: [{ type: "text", text: "two" }] });
    await drain();

    assert.equal(spawned.length, 1, "second turn must not spawn yet");

    await spawned[0]?.emit({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      session_id: "chat-1",
      usage: {},
    });
    spawned[0]?.exit();
    await drain();

    assert.equal(spawned.length, 2, "queued turn spawns once the first ends");
    assert.equal(spawned[1]?.args.at(-1), "two");
  });
});

describe("createSessionHandle interrupt", () => {
  it("kills the current turn's child and does not report it as a crash", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const event of handle.events) events.push(event);
    })();

    handle.send({ role: "user", content: [{ type: "text", text: "one" }] });
    await drain();
    handle.interrupt();
    assert.ok((spawned[0]?.kills.length ?? 0) > 0);
    spawned[0]?.exit();
    await drain();

    // An interrupted turn still clears the "in progress" state (a turn.end),
    // but is not itself surfaced as an error the way a real crash is.
    assert.equal(events.some((e) => e.type === "error"), false);
    assert.equal(events.some((e) => e.type === "turn.end"), true);
  });
});

describe("createSessionHandle abnormal exit", () => {
  it("synthesizes a recoverable error and a zeroed turn.end when no result ever arrives", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const event of handle.events) events.push(event);
    })();

    handle.send({ role: "user", content: [{ type: "text", text: "one" }] });
    await drain();
    // A hard failure: the CLI writes a plain-text line (not JSON) to stderr
    // and exits — no `result` frame, exactly like a real usage-limit hit.
    spawned[0]?.child.stderr.write("ActionRequiredError: You're out of usage.");
    spawned[0]?.exit();
    await drain();

    const error = events.find((e) => e.type === "error");
    assert.ok(error);
    if (error?.type === "error") {
      assert.match(error.message, /out of usage/);
      assert.equal(error.recoverable, true);
    }
    const turnEnd = events.find((e) => e.type === "turn.end");
    assert.ok(turnEnd);
    if (turnEnd?.type === "turn.end") assert.equal(turnEnd.totalCostUsd, 0);

    // The queue must not be stuck — a further send spawns a new turn.
    handle.send({ role: "user", content: [{ type: "text", text: "two" }] });
    await drain();
    assert.equal(spawned.length, 2);
  });
});

describe("createSessionHandle setModel", () => {
  it("emits session.model immediately and arms the next spawn's --model", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const event of handle.events) events.push(event);
    })();

    handle.setModel("gpt-5.3-codex");
    await drain();
    assert.deepEqual(
      events.map((e) => e.type),
      ["session.model"],
    );

    handle.send({ role: "user", content: [{ type: "text", text: "hi" }] });
    await drain();
    assert.ok(spawned[0]?.args.includes("gpt-5.3-codex"));
  });
});

describe("createSessionHandle setPermissionMode", () => {
  it("emits session.mode immediately and arms the next spawn's --mode", async () => {
    const spawned = install();
    const handle = createSessionHandle("chat-1", { projectDir: "/proj" });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const event of handle.events) events.push(event);
    })();

    handle.setPermissionMode("plan");
    await drain();
    assert.deepEqual(
      events.map((e) => e.type),
      ["session.mode"],
    );

    handle.send({ role: "user", content: [{ type: "text", text: "hi" }] });
    await drain();
    const args = spawned[0]?.args ?? [];
    assert.ok(args.includes("--mode"));
    assert.ok(args.includes("plan"));
  });
});
