import { randomUUID } from "node:crypto";
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
import {
  readSnapshot,
  recordAction,
  type WorldSnapshot,
} from "./memory/internal.js";
import { isInsideWorkspace } from "./workspace.js";

/**
 * Per-WebSocket raw CLI console broker.
 *
 * One PTY per socket. Output is never broadcast — only the tab that opened the
 * console sees it. Closing the socket, sending `console.close`, or opening a
 * replacement all terminate the child. When the CLI exits on its own (`/exit`,
 * `/quit`, crash), a `console.exit` frame tells the client to close the window.
 */

type Send = (message: ServerMessage) => void;

interface LiveConsole {
  id: string;
  handle: ConsoleHandle;
}

export type ConsoleResult = { ok: true } | { ok: false; reason: string };

export interface ConsoleSessionDeps {
  readSnapshot?: () => Promise<WorldSnapshot | undefined>;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
  recordAction?: typeof recordAction;
}

export function createConsoleSession(
  send: Send,
  deps: ConsoleSessionDeps = {},
): {
  open: (cols: number, rows: number) => Promise<ConsoleResult>;
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

  let live: LiveConsole | undefined;

  const clear = (id: string | undefined) => {
    if (live !== undefined && (id === undefined || live.id === id)) {
      live = undefined;
    }
  };

  const dispose = () => {
    const current = live;
    live = undefined;
    current?.handle.kill();
  };

  return {
    async open(cols, rows) {
      // Replace any existing console on this socket — one PTY at a time.
      dispose();

      const snapshot = await readSnapshotFn();
      const providerId = snapshot?.attached_provider;
      if (providerId === undefined) {
        return { ok: false, reason: "no provider attached" };
      }

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

      const adapter = getAdapterFn(providerId);
      if (adapter === undefined) {
        return { ok: false, reason: `unknown provider: ${providerId}` };
      }

      let status: AdapterStatus;
      try {
        status = await adapter.getStatus();
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "could not read provider status";
        return { ok: false, reason: detail };
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

      let handle: ConsoleHandle;
      try {
        handle = await adapter.openConsole({
          cwd: projectPath,
          cols,
          rows,
        });
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "could not open console";
        return { ok: false, reason: detail };
      }

      const id = randomUUID();
      const record: LiveConsole = { id, handle };
      live = record;

      handle.onData((data) => {
        if (live !== record) return;
        const frame: ConsoleOutputMessage = {
          type: "console.output",
          id,
          data,
        };
        send(frame);
      });

      handle.onExit((info) => {
        if (live === record) live = undefined;
        const frame: ConsoleExitMessage = {
          type: "console.exit",
          id,
          exitCode: info.exitCode,
          ...(info.signal !== undefined ? { signal: info.signal } : {}),
        };
        send(frame);
      });

      const opened: ConsoleOpenedMessage = { type: "console.opened", id };
      send(opened);

      void recordActionFn({
        actor: "operator",
        action: "console:open",
        outcome: "ok",
        detail: `${providerId} · ${projectPath}`,
      });

      return { ok: true };
    },

    input(id, data) {
      if (live === undefined || live.id !== id) {
        return { ok: false, reason: "no console with that id" };
      }
      live.handle.write(data);
      return { ok: true };
    },

    resize(id, cols, rows) {
      if (live === undefined || live.id !== id) {
        return { ok: false, reason: "no console with that id" };
      }
      live.handle.resize(cols, rows);
      return { ok: true };
    },

    close(id) {
      if (live === undefined || live.id !== id) {
        // Idempotent: closing an already-dead console is not an error.
        return { ok: true };
      }
      const current = live;
      clear(id);
      current.handle.kill();
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
