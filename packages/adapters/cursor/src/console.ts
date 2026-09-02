import type { ConsoleExit, ConsoleHandle, ConsoleOpts } from "@overseer/protocol";

/**
 * Raw interactive `agent` PTY — the escape hatch behind OPEN CONSOLE.
 *
 * Distinct from the stream-json turns `session-handle.ts` spawns: this is the
 * CLI's own TUI. Overseer neither parses the output nor rewrites input; the
 * server closes the window when the CLI process exits. Unlike the stream-json
 * path, this passes no `--trust`/`--force` — a human is watching, so the
 * CLI's own trust dialog (verified: it appears on an untrusted cwd) is
 * exactly what should happen here.
 */

const CLI = "agent";

/** Graceful signal window before a forced kill — same rationale as
 * session-handle.ts's `killProcessGroup`. */
const KILL_GRACE_MS = 5_000;

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
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
export function setConsoleSpawner(next: PtySpawner | undefined): void {
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

export async function openConsole(opts: ConsoleOpts): Promise<ConsoleHandle> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  const proc = await spawnPty({
    file: CLI,
    args: [],
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    env,
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
        console.error("adapter-cursor: console onExit listener threw", error);
      }
    }
    settle(info);
  };

  proc.onData((data) => {
    for (const listener of dataListeners) {
      try {
        listener(data);
      } catch (error) {
        console.error("adapter-cursor: console onData listener threw", error);
      }
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    finish({ exitCode: exitCode ?? -1, ...(signal ? { signal } : {}) });
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
