import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type {
  PermissionDecision,
  SessionHandle,
  SessionOpts,
  UserMessage,
} from "@overseer/protocol";
import { exitEvent, normalizeLine, type NormalizeTurnState } from "./normalize.js";

const CLI = "agent";
const KILL_GRACE_MS = 5_000;

const execFileAsync = promisify(execFile);

export type SessionSpawner = (opts: {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => ChildProcessWithoutNullStreams;

let spawner: SessionSpawner | undefined;

/** Test seam — inject a fake `agent` process. */
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

/** Text out of a `UserMessage` — the CLI's prompt is one positional string,
 * not a structured content array. An image part has nowhere to go (no CLI
 * attachment mechanism) and is silently dropped rather than failing the
 * whole send. */
function textFromMessage(msg: UserMessage): string {
  return msg.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function buildArgs(chatId: string, prompt: string, opts: SessionOpts): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    // No interactive approval loop exists under --print (capabilities.
    // permissionPrompts is false) — trust and force are what let a tool call
    // run at all rather than hang or refuse.
    "--trust",
    "--force",
    "--sandbox",
    "disabled",
    "--resume",
    chatId,
  ];
  if (opts.model !== undefined && opts.model !== "") args.push("--model", opts.model);
  // Only the two read-only modes are a `--mode` value; "default" (full
  // access, the ordinary case) is expressed by omitting the flag — --force
  // above already grants everything a mode does not explicitly deny.
  if (opts.permissionMode === "plan" || opts.permissionMode === "ask") {
    args.push("--mode", opts.permissionMode);
  }
  args.push(prompt);
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

/**
 * Cursor has no `--input-format stream-json` — no bidirectional control
 * channel to hold one process open across turns the way claude-code does.
 * So this spawns one child *per turn*, resumed onto the same chat id
 * (`--resume`, verified to preserve context and reuse the id); `events` is
 * one queue that outlives every one of those children for as long as the
 * logical session (the `SessionHandle`) is open.
 *
 * A turn that ends without ever producing a `result` frame (a crash, a
 * plain-text CLI error like a usage-limit `ActionRequiredError`, an
 * interrupt) does not end the *session* — only claude-code's exit ends a
 * session, because there a dead process really is a dead session. Here it
 * synthesizes a recoverable `error` (and a zeroed `turn.end` so the UI's
 * "turn in progress" state clears) and the queue stays open for the next
 * `send`.
 */
export function createSessionHandle(
  chatId: string,
  opts: SessionOpts,
): SessionHandle {
  const queue = new AsyncEventQueue<import("@overseer/protocol").AgentEvent>();
  const pendingMessages: UserMessage[] = [];
  let turnInFlight = false;
  let closed = false;
  let interrupting = false;
  let currentChild: ChildProcessWithoutNullStreams | undefined;
  /** Retargeted by `setModel` for the *next* turn — cursor has no runtime
   * control request to arm an already-running process with, so this simply
   * changes what the next spawn's `--model` is. */
  let model = opts.model;

  const timestamp = () => new Date().toISOString();

  function spawnTurn(msg: UserMessage): void {
    turnInFlight = true;
    interrupting = false;
    const turn: NormalizeTurnState = { emittedText: false };
    const ctx = { sessionId: chatId, timestamp, turn };
    let sawResult = false;

    const spawnFn = spawner ?? defaultSpawner;
    const child = spawnFn({
      file: CLI,
      args: buildArgs(chatId, textFromMessage(msg), { ...opts, model }),
      cwd: opts.projectDir,
      env: process.env,
    });
    currentChild = child;

    let buffer = "";
    let stderrTail = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== "") {
          for (const event of normalizeLine(line, ctx)) {
            if (event.type === "permission.request") {
              // Never actually emitted — capabilities.permissionPrompts is
              // false and normalize.ts has no path that produces one — kept
              // only so a future stream-json addition fails loud in review
              // rather than silently reaching the operator unhandled.
              continue;
            }
            if (event.type === "turn.end") sawResult = true;
            queue.push(event);
          }
        }
        index = buffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrTail = (stderrTail + text).slice(-2000);
    });

    child.on("exit", () => {
      currentChild = undefined;
      const wasInterrupting = interrupting;
      interrupting = false;
      turnInFlight = false;

      if (!sawResult && !closed) {
        // Cursor prints a plain-text line (not JSON) on a hard failure like
        // a usage-limit ActionRequiredError, and produces nothing at all
        // once SIGKILLed — either way, no `result` frame ever arrived, so
        // nothing above has told the UI this turn is over.
        if (!wasInterrupting) {
          const detail = stderrTail.trim();
          queue.push({
            type: "error",
            sessionId: chatId,
            timestamp: timestamp(),
            message: detail === "" ? "agent CLI exited without a result" : detail,
            recoverable: true,
          });
        }
        queue.push({
          type: "turn.end",
          sessionId: chatId,
          timestamp: timestamp(),
          usage: { inputTokens: 0, outputTokens: 0 },
          totalCostUsd: 0,
          durationMs: 0,
          numTurns: 0,
        });
      }

      flushSendQueue();
    });

    child.on("error", () => {
      // spawn itself failed (binary missing, etc.) — `exit` never fires.
      currentChild = undefined;
      turnInFlight = false;
      queue.push({
        type: "error",
        sessionId: chatId,
        timestamp: timestamp(),
        message: "could not start the agent CLI",
        recoverable: true,
      });
      flushSendQueue();
    });
  }

  function flushSendQueue(): void {
    if (turnInFlight || closed || pendingMessages.length === 0) return;
    const msg = pendingMessages.shift();
    if (msg === undefined) return;
    spawnTurn(msg);
  }

  const handle: SessionHandle = {
    events: queue,

    send(msg: UserMessage): void {
      if (closed) return;
      pendingMessages.push(msg);
      flushSendQueue();
    },

    interrupt(): void {
      if (currentChild === undefined) return;
      interrupting = true;
      killProcessGroup(currentChild);
    },

    setModel(nextModel: string): void {
      model = nextModel;
      queue.push({
        type: "session.model",
        sessionId: chatId,
        timestamp: timestamp(),
        model: nextModel,
      });
    },

    resolvePermission(): void {
      // No permission-request path exists to resolve (see the comment on
      // the discarded event above) — present only to satisfy the interface.
    },

    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      pendingMessages.length = 0;
      if (currentChild !== undefined) killProcessGroup(currentChild);
      queue.finish();
      return Promise.resolve();
    },
  };

  return handle;
}

/** `agent create-chat` mints a chat id the CLI will later accept back via
 * `--resume`, without opening a turn on it — the same role
 * claude-code's in-process `randomUUID()` plays, just a CLI round-trip
 * instead of a local computation. */
export async function mintSessionId(): Promise<string> {
  const { stdout } = await execFileAsync(CLI, ["create-chat"]);
  const id = stdout.trim();
  if (id === "") throw new Error("agent create-chat returned no id");
  return id;
}

export function openSession(chatId: string, opts: SessionOpts): SessionHandle {
  return createSessionHandle(chatId, opts);
}
