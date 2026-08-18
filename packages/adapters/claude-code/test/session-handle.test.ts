import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, describe, it } from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentEvent } from "@overseer/protocol";
import adapter from "../src/index.js";
import {
  createSessionHandle,
  setSessionSpawner,
} from "../src/session-handle.js";

interface Fake {
  child: ChildProcessWithoutNullStreams;
  written: string[];
  emit: (line: unknown) => Promise<void>;
  args: string[];
}

/** A stand-in for the claude process that records stdin and replays stdout. */
function fakeProcess(): Fake {
  const emitter = new EventEmitter();
  const written: string[] = [];
  const stdout = new PassThrough();
  const child = Object.assign(emitter, {
    // No pid: keeps the teardown path away from process.kill.
    pid: undefined,
    stdout,
    stderr: new PassThrough(),
    stdin: {
      writable: true,
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    },
    kill: () => true,
  }) as unknown as ChildProcessWithoutNullStreams;

  const fake: Fake = {
    child,
    written,
    args: [],
    emit: async (line: unknown) => {
      stdout.write(`${JSON.stringify(line)}\n`);
      await new Promise((r) => setImmediate(r));
    },
  };
  return fake;
}

function install(): Fake {
  const fake = fakeProcess();
  setSessionSpawner((opts) => {
    fake.args = opts.args;
    return fake.child;
  });
  return fake;
}

after(() => setSessionSpawner(undefined));

const frames = (written: string[]) =>
  written.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("createSessionHandle stdin", () => {
  it("writes the first message without waiting for any stdout", () => {
    // The CLI emits nothing until it has been written to, so a handle that
    // waits for output before sending deadlocks the session outright.
    const fake = install();
    const handle = createSessionHandle("s1", { projectDir: "/workspace" });

    handle.send({ role: "user", content: [{ type: "text", text: "hello" }] });

    assert.equal(fake.written.length, 1);
    const [frame] = frames(fake.written);
    assert.equal(frame.type, "user");
    assert.deepEqual(frame.message, {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("holds the next message until the turn in flight ends", async () => {
    const fake = install();
    const handle = createSessionHandle("s2", { projectDir: "/workspace" });

    handle.send({ role: "user", content: [{ type: "text", text: "one" }] });
    handle.send({ role: "user", content: [{ type: "text", text: "two" }] });
    assert.equal(fake.written.length, 1);

    await fake.emit({ type: "result", total_cost_usd: 0.01 });
    assert.equal(fake.written.length, 2);
    assert.deepEqual(frames(fake.written)[1].message, {
      role: "user",
      content: [{ type: "text", text: "two" }],
    });
  });

  it("sends interrupts as a nested, identified control request", () => {
    // A flat {type, subtype} frame makes the CLI's stdin parser throw on
    // `request.subtype` and takes the whole process down with it.
    const fake = install();
    const handle = createSessionHandle("s3", { projectDir: "/workspace" });

    handle.interrupt();

    const [frame] = frames(fake.written);
    assert.equal(frame.type, "control_request");
    assert.equal(typeof frame.request_id, "string");
    assert.deepEqual(frame.request, { subtype: "interrupt" });
  });

  it("answers a permission request in the CLI's response envelope", async () => {
    const fake = install();
    const handle = createSessionHandle("s4", { projectDir: "/workspace" });

    await fake.emit({
      type: "control_request",
      request_id: "req_9",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "ls" },
      },
    });
    handle.resolvePermission("req_9", {
      decision: "deny",
      feedback: "not yet",
    });

    const [frame] = frames(fake.written);
    assert.equal(frame.type, "control_response");
    assert.deepEqual(frame.response, {
      subtype: "success",
      request_id: "req_9",
      response: { behavior: "deny", message: "not yet" },
    });
  });

  it("returns the original input when allowing a tool", async () => {
    const fake = install();
    const handle = createSessionHandle("s5", { projectDir: "/workspace" });

    await fake.emit({
      type: "control_request",
      request_id: "req_10",
      request: {
        subtype: "can_use_tool",
        tool_name: "Read",
        input: { file_path: "/etc/hostname" },
      },
    });
    handle.resolvePermission("req_10", { decision: "allow-once" });

    const response = frames(fake.written)[0].response as Record<string, unknown>;
    assert.deepEqual(response.response, {
      behavior: "allow",
      updatedInput: { file_path: "/etc/hostname" },
    });
  });
});

describe("createSessionHandle argv", () => {
  it("mints a session id for a new session and resumes an existing one", () => {
    const fresh = install();
    createSessionHandle("s6", { projectDir: "/workspace" });
    assert.ok(fresh.args.includes("--session-id"));
    assert.equal(fresh.args[fresh.args.indexOf("--session-id") + 1], "s6");
    assert.equal(fresh.args.includes("--resume"), false);

    const resumed = install();
    createSessionHandle("s7", {
      projectDir: "/workspace",
      resumeSessionId: "s7",
    });
    assert.ok(resumed.args.includes("--resume"));
    assert.equal(resumed.args.includes("--session-id"), false);
  });
});

describe("createSessionHandle stdout", () => {
  it("streams normalized events off the child's stdout", async () => {
    const fake = install();
    const handle = createSessionHandle("s8", { projectDir: "/workspace" });

    const seen: AgentEvent[] = [];
    void (async () => {
      for await (const event of handle.events) seen.push(event);
    })();

    await fake.emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hi" },
      },
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, "text.delta");
    assert.equal(seen[0].sessionId, "s8");
  });
});

describe("resumeSession", () => {
  it("finds the project dir when the transcript opens without a cwd", async () => {
    // Real transcripts start with bookkeeping records (`mode`,
    // `queue-operation`) that carry no path — reading only the first line
    // makes every dormant session fail to resume.
    const configDir = await mkdtemp(path.join(tmpdir(), "cfg-"));
    const slug = "-workspace-demo";
    await mkdir(path.join(configDir, "projects", slug), { recursive: true });
    await writeFile(
      path.join(configDir, "projects", slug, "sess-1.jsonl"),
      [
        JSON.stringify({ type: "mode", mode: "default", sessionId: "sess-1" }),
        JSON.stringify({ type: "queue-operation" }),
        JSON.stringify({ type: "user", cwd: "/workspace/demo" }),
      ].join("\n"),
    );

    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const fake = install();
    let seenCwd = "";
    setSessionSpawner((opts) => {
      fake.args = opts.args;
      seenCwd = opts.cwd;
      return fake.child;
    });

    try {
      await adapter.resumeSession("sess-1");
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }

    assert.equal(seenCwd, "/workspace/demo");
    assert.ok(fake.args.includes("--resume"));
    assert.equal(fake.args[fake.args.indexOf("--resume") + 1], "sess-1");
  });

  it("still reports a session it cannot place", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "cfg-"));
    await mkdir(path.join(configDir, "projects", "-workspace-demo"), {
      recursive: true,
    });
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      await assert.rejects(
        () => adapter.resumeSession("missing"),
        /session not found: missing/,
      );
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });
});
