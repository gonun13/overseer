import type { ConsoleExit, ConsoleHandle } from "@overseer/protocol";

/**
 * Raw PTY onto the dev loop's overseer session — `/app/loop/run <name>`, the
 * same entrypoint `./bin/loop <name>` execs into this container from the
 * host. This is a second front end on that one entrypoint, not a second
 * implementation of it: loop's own provider choice, session leasing, and
 * overseer prompt are entirely its own business. `OVERSEER_IN_CONTAINER=1` is
 * set as a persistent image `ENV`, so `loop/run`'s host guard passes here the
 * same way it does under `docker compose exec`.
 *
 * Deliberately independent of `@overseer/adapter-claude-code`: loop can run
 * any provider bundle under `providers/`, so this has nothing to do with
 * which provider (if any) Overseer itself has attached.
 */

const LOOP_RUN = "/app/loop/run";
const APP_DIR = "/app";

/** Graceful signal window before a forced kill — same rationale as the
 * claude-code adapter's console/login PTYs. */
const KILL_GRACE_MS = 5_000;

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void,
  ): void;
}

export type PtySpawner = (opts: {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}) => PtyProcess | Promise<PtyProcess>;

let spawner: PtySpawner | undefined;

/** Test seam — inject a fake PTY. Pass `undefined` to restore the default. */
export function setLoopConsoleSpawner(next: PtySpawner | undefined): void {
  spawner = next;
}

async function spawnPty(opts: {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}): Promise<PtyProcess> {
  if (spawner !== undefined) return spawner(opts);

  // Dynamic import so unit tests can inject a fake without loading the native
  // module, and so a missing build surfaces as an openLoopConsole failure
  // rather than taking down the whole server import graph.
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

export interface LoopConsoleOpts {
  /** Workspace directory name — `loop/run` resolves it under `workspace/`. */
  name: string;
  cols: number;
  rows: number;
}

/** Spawn `loop/run <name>` in a PTY. Mirrors the claude-code adapter's
 * `openConsole` shape so `console.ts`'s broker needs no changes to consume
 * either. */
export async function openLoopConsole(
  opts: LoopConsoleOpts,
): Promise<ConsoleHandle> {
  const proc = await spawnPty({
    file: LOOP_RUN,
    args: [opts.name],
    cwd: APP_DIR,
    cols: opts.cols,
    rows: opts.rows,
    env: process.env,
  });

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
        console.error("loop-console: onExit listener threw", error);
      }
    }
    settle(info);
  };

  proc.onData((data) => {
    for (const listener of dataListeners) {
      try {
        listener(data);
      } catch (error) {
        console.error("loop-console: onData listener threw", error);
      }
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    finish({
      exitCode: exitCode ?? -1,
      ...(signal ? { signal } : {}),
    });
  });

  return {
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
    resize(nextCols, nextRows) {
      if (exited) return;
      try {
        proc.resize(nextCols, nextRows);
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
      if (killTimer !== undefined) return;
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
