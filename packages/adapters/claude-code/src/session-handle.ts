import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  PermissionDecision,
  SessionHandle,
  SessionOpts,
  UserMessage,
} from "@overseer/protocol";
import { exitEvent, normalizeLine } from "./normalize.js";

const CLI = "claude";
const KILL_GRACE_MS = 5_000;

export type SessionSpawner = (opts: {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => ChildProcessWithoutNullStreams;

let spawner: SessionSpawner | undefined;

/** Test seam — inject a fake claude process. */
export function setSessionSpawner(next: SessionSpawner | undefined): void {
  spawner = next;
}

function defaultSpawner(opts: {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ChildProcessWithoutNullStreams {
  return spawn(opts.file, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function killProcessGroup(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      // Already dead.
    }
  }, KILL_GRACE_MS);
}

function buildArgs(sessionId: string, opts: SessionOpts): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--include-hook-events",
    "--forward-subagent-text",
    "--replay-user-messages",
    "--verbose",
  ];
  if (opts.resumeSessionId !== undefined) {
    args.push("--resume", opts.resumeSessionId);
  } else {
    args.push("--session-id", sessionId);
  }
  if (opts.model !== undefined) args.push("--model", opts.model);
  if (opts.permissionMode !== undefined) {
    args.push("--permission-mode", opts.permissionMode);
  }
  if (opts.effort !== undefined) args.push("--effort", opts.effort);
  // Empty means the operator picked the "none" row — that is a choice to pass
  // no `--agent`, not a subagent named "".
  if (opts.agent !== undefined && opts.agent !== "") {
    args.push("--agent", opts.agent);
  }
  if (opts.name !== undefined) args.push("-n", opts.name);
  return args;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(value: IteratorResult<T>) => void> = [];
  private done = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  finish(): void {
    this.done = true;
    for (const waiter of this.waiters) waiter({ value: undefined as T, done: true });
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.done) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export function createSessionHandle(
  sessionId: string,
  opts: SessionOpts,
): SessionHandle {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ??
    `${process.env.HOME ?? "/home/node"}/.claude`;

  const spawnFn = spawner ?? defaultSpawner;
  const child = spawnFn({
    file: CLI,
    args: buildArgs(sessionId, opts),
    cwd: opts.projectDir,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  });

  const queue = new AsyncEventQueue<import("@overseer/protocol").AgentEvent>();
  const pendingMessages: UserMessage[] = [];
  let turnInFlight = false;
  let closed = false;
  let controlSeq = 0;
  const pendingPermissions = new Map<
    string,
    { toolName: string; input: unknown }
  >();
  /** `set_model` requests awaiting their `control_response`, keyed by request
   * id — the response itself doesn't echo the model back. */
  const pendingModelRequests = new Map<string, string>();
  /** The model the most recent `assistant` frame ran on. `turn.end` has no
   * model of its own; this is what attaches one to it. */
  let lastAssistantModel: string | undefined;

  const turn = { emittedText: false };
  const ctx = {
    sessionId,
    timestamp: () => new Date().toISOString(),
    turn,
  };

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== "") {
        handleControlResponse(line);
        for (const event of normalizeLine(line, ctx)) {
          if (event.type === "permission.request") {
            pendingPermissions.set(event.requestId, {
              toolName: event.toolName,
              input: event.input,
            });
          }
          if (event.type === "turn.end") {
            turnInFlight = false;
            flushSendQueue();
            queue.push(
              lastAssistantModel !== undefined
                ? { ...event, model: lastAssistantModel }
                : event,
            );
            continue;
          }
          queue.push(event);
        }
      }
      index = buffer.indexOf("\n");
    }
  });

  /** Track the model each `assistant` frame ran on, and resolve any
   * `set_model` control request awaiting this line's `control_response`.
   * Both read the raw frame directly — neither is a normalized `AgentEvent`. */
  function handleControlResponse(line: string): void {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof record !== "object" || record === null) return;
    const obj = record as Record<string, unknown>;

    if (obj.type === "assistant") {
      const message = obj.message as Record<string, unknown> | undefined;
      if (typeof message?.model === "string" && message.model !== "") {
        lastAssistantModel = message.model;
      }
      return;
    }

    if (obj.type !== "control_response") return;
    const response = obj.response as Record<string, unknown> | undefined;
    const requestId = response?.request_id;
    if (typeof requestId !== "string") return;
    const model = pendingModelRequests.get(requestId);
    if (model === undefined) return;
    pendingModelRequests.delete(requestId);

    if (response?.subtype === "success") {
      queue.push({
        type: "session.model",
        sessionId,
        timestamp: ctx.timestamp(),
        model,
      });
    } else {
      const detail =
        typeof response?.error === "string" ? response.error : "rejected";
      queue.push({
        type: "error",
        sessionId,
        timestamp: ctx.timestamp(),
        message: `model switch failed: ${detail}`,
        recoverable: true,
      });
    }
  }

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text === "") return;
    queue.push({
      type: "error",
      sessionId,
      timestamp: new Date().toISOString(),
      message: text,
      recoverable: true,
    });
  });

  child.on("exit", (code, signal) => {
    if (closed) return;
    const cause =
      code === 0 ? "user" : signal === "SIGTERM" ? "idle" : "crash";
    queue.push(exitEvent(sessionId, cause, code));
    queue.finish();
  });

  function writeLine(obj: unknown): void {
    if (child.stdin.writable) {
      child.stdin.write(`${JSON.stringify(obj)}\n`);
    }
  }

  function writeUserMessage(msg: UserMessage): void {
    writeLine({
      type: "user",
      session_id: sessionId,
      message: {
        role: "user",
        content: msg.content,
      },
      parent_tool_use_id: null,
    });
  }

  function flushSendQueue(): void {
    if (turnInFlight || pendingMessages.length === 0) return;
    const msg = pendingMessages.shift();
    if (msg === undefined) return;
    turnInFlight = true;
    writeUserMessage(msg);
  }

  const handle: SessionHandle = {
    events: queue,

    send(msg: UserMessage): void {
      if (closed) return;
      pendingMessages.push(msg);
      flushSendQueue();
    },

    interrupt(): void {
      controlSeq += 1;
      writeLine({
        type: "control_request",
        request_id: `req_${controlSeq}_interrupt`,
        request: { subtype: "interrupt" },
      });
    },

    setModel(model: string): void {
      controlSeq += 1;
      const requestId = `req_${controlSeq}_set_model`;
      pendingModelRequests.set(requestId, model);
      writeLine({
        type: "control_request",
        request_id: requestId,
        request: { subtype: "set_model", model },
      });
    },

    resolvePermission(id: string, decision: PermissionDecision): void {
      const pending = pendingPermissions.get(id);
      pendingPermissions.delete(id);
      if (pending === undefined) return;

      if (decision.decision === "deny") {
        writeLine({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: id,
            response: {
              behavior: "deny",
              message: decision.feedback ?? "denied by the operator",
            },
          },
        });
        return;
      }

      writeLine({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: id,
          response: {
            behavior: "allow",
            updatedInput: pending.input,
            ...(decision.decision === "allow-always"
              ? { updatedPermissions: [{ type: "addRules", rules: [decision.rule] }] }
              : {}),
          },
        },
      });
    },

    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      killProcessGroup(child);
      queue.finish();
      return new Promise((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(resolve, KILL_GRACE_MS + 100);
      });
    },
  };

  return handle;
}

export function mintSessionId(): string {
  return randomUUID();
}

export function openSession(
  sessionId: string,
  opts: SessionOpts,
): SessionHandle {
  return createSessionHandle(sessionId, opts);
}
