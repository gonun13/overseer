import type { ConsoleExit, ConsoleHandle, ConsoleOpts } from "@overseer/protocol";
import { ensureInteractiveReady } from "./interactive-ready.js";

/**
 * Raw interactive `claude` PTY — the escape hatch behind OPEN CONSOLE.
 *
 * Distinct from stream-json agent sessions (architecture-design.md §1.2): this
 * is the CLI's own TUI, slash commands and all. Overseer neither parses the
 * output nor rewrites input; `/exit` / `/quit` end the process because the CLI
 * exits, and the server closes the window on that exit.
 */

const CLI = "claude";

/** Graceful signal window before a forced kill — same rationale as login.ts. */
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

  // Dynamic import so unit tests can inject a fake without loading the native
  // module, and so a missing build surfaces as an openConsole failure rather
  // than taking down the whole adapter import graph.
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

/**
 * Spawn an interactive `claude` in `opts.cwd`. Auth comes from the container's
 * `CLAUDE_CONFIG_DIR` volume — the same one login writes. Before spawn we mark
 * interactive onboarding complete so the TUI does not re-ask for a browser
 * login the pipe-based auth flow already finished.
 */
export async function openConsole(opts: ConsoleOpts): Promise<ConsoleHandle> {
  await ensureInteractiveReady(opts.cwd);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    // Container has no GUI; if the CLI still tries to open a browser, sink it.
    BROWSER: process.env.BROWSER ?? "/bin/true",
    // CLI is image-pinned and installed as root; the `node` user cannot write
    // the npm prefix, so auto-update would only spam the TUI with a permission
    // error. Version bumps go through the Dockerfile pin.
    DISABLE_AUTOUPDATER: process.env.DISABLE_AUTOUPDATER ?? "1",
    // Harder lock: skip manual `claude update` paths too (same pin reason).
    DISABLE_UPDATES: process.env.DISABLE_UPDATES ?? "1",
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
        console.error("adapter-claude-code: console onExit listener threw", error);
      }
    }
    settle(info);
  };

  proc.onData((data) => {
    for (const listener of dataListeners) {
      try {
        listener(data);
      } catch (error) {
        console.error("adapter-claude-code: console onData listener threw", error);
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
