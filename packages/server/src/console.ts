import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AdapterStatus,
  AgentAdapter,
  ConsoleHandle,
  ConsoleOpenedMessage,
  ConsoleOutputMessage,
  ConsoleExitMessage,
  ErrorMessage,
  ServerMessage,
} from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { openLoopConsole } from "./loop-console.js";
import { takeoverLoop } from "./loop-sessions.js";
import {
  readSnapshot,
  recordAction,
  type WorldSnapshot,
} from "./memory/internal.js";
import { isInsideWorkspace } from "./workspace.js";

/**
 * Per-WebSocket raw CLI console broker.
 *
 * One PTY per slot per socket. Output is never broadcast — only the tab that
 * opened the console sees it. Closing the socket, sending `console.close`, or
 * opening a replacement *in the same slot* terminate the child. When the CLI
 * exits on its own (`/exit`, `/quit`, crash), a `console.exit` frame tells the
 * client to close the window.
 */

type Send = (message: ServerMessage) => void;

/**
 * Which PTY a console occupies. The raw provider CLI and a dev-loop run are
 * different things with different lifetimes — a loop can be mid-request while
 * the operator wants a shell — so they get a slot each and opening one never
 * terminates the other. Slots are per socket, not global: two tabs still get
 * their own pair.
 */
type ConsoleSlot = "provider" | "loop";

interface LiveConsole {
  id: string;
  slot: ConsoleSlot;
  handle: ConsoleHandle;
}

export type ConsoleResult = { ok: true } | { ok: false; reason: string };

export interface ConsoleSessionDeps {
  readSnapshot?: () => Promise<WorldSnapshot | undefined>;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
  recordAction?: typeof recordAction;
  takeoverLoop?: typeof takeoverLoop;
}

export function createConsoleSession(
  send: Send,
  deps: ConsoleSessionDeps = {},
): {
  open: (
    cols: number,
    rows: number,
    mode?: "loop",
    takeover?: boolean,
  ) => Promise<ConsoleResult>;
  input: (id: string, data: string) => ConsoleResult;
  resize: (id: string, cols: number, rows: number) => ConsoleResult;
  close: (id: string) => ConsoleResult;
  /** Tear down whatever is live — socket close / pagehide. */
  dispose: () => void;
} {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;
  const recordActionFn = deps.recordAction ?? recordAction;
  const takeoverLoopFn = deps.takeoverLoop ?? takeoverLoop;

  const live = new Map<ConsoleSlot, LiveConsole>();

  const findById = (id: string): LiveConsole | undefined => {
    for (const record of live.values()) {
      if (record.id === id) return record;
    }
    return undefined;
  };

  /** Terminate one slot's child, leaving the other slot alone. */
  const killSlot = (slot: ConsoleSlot) => {
    const current = live.get(slot);
    if (current === undefined) return;
    live.delete(slot);
    current.handle.kill();
  };

  const dispose = () => {
    const records = [...live.values()];
    live.clear();
    for (const record of records) record.handle.kill();
  };

  return {
    async open(cols, rows, mode, takeover) {
      const slot: ConsoleSlot = mode === "loop" ? "loop" : "provider";
      // Replace only this slot's console. The other slot is a different thing
      // with its own lifetime — opening a shell must not kill a running loop.
      killSlot(slot);

      const snapshot = await readSnapshotFn();

      const projectPath = snapshot?.last_active_project;
      if (projectPath === undefined) {
        return { ok: false, reason: "no active project" };
      }
      if (!(await isInsideWorkspaceFn(projectPath))) {
        return {
          ok: false,
          reason: "active project is not inside the workspace",
        };
      }

      let handle: ConsoleHandle;
      let detail: string;

      if (mode === "loop") {
        // The dev loop picks its own provider (loop/.provider / LOOP_PROVIDER),
        // independently of whatever Overseer itself has attached — so this
        // path skips the attached-provider/auth checks below entirely. If
        // loop's own provider isn't signed in, loop/run says so in the PTY,
        // same as it would from a host terminal via ./bin/loop.
        const name = path.basename(projectPath);

        // The operator answered a decision to take the run over: end the one
        // holding the lease first, or `loop/run` would refuse to claim it.
        if (takeover === true) {
          const result = await takeoverLoopFn(name);
          if (!result.ok) return { ok: false, reason: result.reason };
          if (result.killed) {
            void recordActionFn({
              actor: "operator",
              action: "loop:takeover",
              outcome: "ok",
              detail: name,
            });
          }
        }

        try {
          handle = await openLoopConsole({ name, cols, rows });
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "could not open loop console";
          return { ok: false, reason };
        }
        detail = `loop · ${name}`;
      } else {
        const providerId = snapshot?.attached_provider;
        if (providerId === undefined) {
          return { ok: false, reason: "no provider attached" };
        }

        const adapter = getAdapterFn(providerId);
        if (adapter === undefined) {
          return { ok: false, reason: `unknown provider: ${providerId}` };
        }

        let status: AdapterStatus;
        try {
          status = await adapter.getStatus();
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "could not read provider status";
          return { ok: false, reason };
        }
        if (!status.authenticated) {
          return { ok: false, reason: "provider is not signed in" };
        }

        if (adapter.openConsole === undefined) {
          return {
            ok: false,
            reason: `${providerId} has no interactive console`,
          };
        }

        try {
          handle = await adapter.openConsole({
            cwd: projectPath,
            cols,
            rows,
          });
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "could not open console";
          return { ok: false, reason };
        }
        detail = `${providerId} · ${projectPath}`;
      }

      const id = randomUUID();
      const record: LiveConsole = { id, slot, handle };
      live.set(slot, record);

      handle.onData((data) => {
        if (live.get(slot) !== record) return;
        const frame: ConsoleOutputMessage = {
          type: "console.output",
          id,
          data,
        };
        send(frame);
      });

      handle.onExit((info) => {
        if (live.get(slot) === record) live.delete(slot);
        const frame: ConsoleExitMessage = {
          type: "console.exit",
          id,
          exitCode: info.exitCode,
          ...(info.signal !== undefined ? { signal: info.signal } : {}),
        };
        send(frame);
      });

      const opened: ConsoleOpenedMessage = {
        type: "console.opened",
        id,
        ...(mode !== undefined ? { mode } : {}),
      };
      send(opened);

      void recordActionFn({
        actor: "operator",
        action: "console:open",
        outcome: "ok",
        detail,
      });

      return { ok: true };
    },

    input(id, data) {
      const record = findById(id);
      if (record === undefined) {
        return { ok: false, reason: "no console with that id" };
      }
      record.handle.write(data);
      return { ok: true };
    },

    resize(id, cols, rows) {
      const record = findById(id);
      if (record === undefined) {
        return { ok: false, reason: "no console with that id" };
      }
      record.handle.resize(cols, rows);
      return { ok: true };
    },

    close(id) {
      const record = findById(id);
      if (record === undefined) {
        // Idempotent: closing an already-dead console is not an error.
        return { ok: true };
      }
      live.delete(record.slot);
      record.handle.kill();
      return { ok: true };
    },

    dispose,
  };
}

/** Map a console refusal onto the shared error frame shape. */
export function consoleError(about: string, reason: string): ErrorMessage {
  return {
    type: "error",
    about,
    benign: true,
    message: reason,
  };
}
