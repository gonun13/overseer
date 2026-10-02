import type { ConsoleExit, ConsoleHandle } from "@overseer/protocol";

/**
 * The one place Overseer spawns a PTY. Adapters describe their CLI's command
 * line (`consoleCommand`); the dev loop and plain shells are commands too. All
 * of them run through here so lifetime and kill semantics are the same for
 * every console.
 */

/** Graceful signal window before a forced kill — a wedged CLI must not pin a
 * console forever. */
const KILL_GRACE_MS = 5_000;

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
}

export interface PtySpawnOpts {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}

export type PtySpawner = (opts: PtySpawnOpts) => PtyProcess | Promise<PtyProcess>;

let spawner: PtySpawner | undefined;

/** Test seam — inject a fake PTY. Pass `undefined` to restore the default. */
export function setPtySpawner(next: PtySpawner | undefined): void {
  spawner = next;
}

async function spawnProcess(opts: PtySpawnOpts): Promise<PtyProcess> {
  if (spawner !== undefined) return spawner(opts);

  // Dynamic import so unit tests can inject a fake without loading the native
  // module, and so a missing build surfaces as a failed open rather than
  // taking down the whole server import graph.
  const pty = await import("node-pty");
  const proc = pty.spawn(opts.file, opts.args, {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env as Record<string, string>,
  });
  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
    onData: (listener) => {
      proc.onData(listener);
    },
    onExit: (listener) => {
      proc.onExit(listener);
    },
  };
}

export interface PtyHandle extends ConsoleHandle {
  pid: number;
}

export async function spawnPty(opts: PtySpawnOpts): Promise<PtyHandle> {
  const proc = await spawnProcess(opts);

  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(info: ConsoleExit) => void>();
  let exited = false;
  let killing = false;
  let exitInfo: ConsoleExit = { exitCode: -1 };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let settle!: (info: ConsoleExit) => void;
  const done = new Promise<ConsoleExit>((resolve) => {
    settle = resolve;
  });

  const finish = (info: ConsoleExit) => {
    if (exited) return;
    exited = true;
    exitInfo = info;
    if (killTimer !== undefined) clearTimeout(killTimer);
    for (const listener of exitListeners) {
      try {
        listener(info);
      } catch (error) {
        console.error("pty: onExit listener threw", error);
      }
    }
    settle(info);
  };

  proc.onData((data) => {
    for (const listener of dataListeners) {
      try {
        listener(data);
      } catch (error) {
        console.error("pty: onData listener threw", error);
      }
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    finish({ exitCode: exitCode ?? -1, ...(signal ? { signal } : {}) });
  });

  return {
    pid: proc.pid,
    onData(listener) {
      dataListeners.add(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (exited) listener(exitInfo);
    },
    write(data) {
      if (exited) return;
      try {
        proc.write(data);
      } catch {
        // EPIPE / closed PTY — exit will follow.
      }
    },
    resize(cols, rows) {
      if (exited) return;
      try {
        proc.resize(cols, rows);
      } catch {
        // Process already gone.
      }
    },
    kill() {
      if (exited || killing) return;
      killing = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        finish({ exitCode: -1 });
        return;
      }
      killTimer = setTimeout(() => {
        if (exited) return;
        try {
          proc.kill("SIGKILL");
        } catch {
          finish({ exitCode: -1 });
        }
      }, KILL_GRACE_MS);
    },
    done,
  };
}

/** Environment every console gets on top of the server's own. */
export function consoleEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...extra,
  };
}
