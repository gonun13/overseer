import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AdapterStatus,
  AgentAdapter,
  ConsoleActivity,
  ConsoleCommand,
  ConsoleInfo,
  ConsoleKind,
  ErrorMessage,
  ServerMessage,
} from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { loopSessionIndex, takeoverLoop } from "./loop-sessions.js";
import { recordAction } from "./memory/internal.js";
import { consoleEnv, spawnPty, type PtyHandle } from "./pty.js";
import { noteProviderSignedOut } from "./usage-refresh.js";
import { isInsideWorkspace } from "./workspace.js";

/**
 * Every console Overseer runs — provider CLIs, shells, dev-loop runs.
 *
 * Consoles belong to the server, not to a browser tab. A socket *attaches* to
 * see one (scrollback replay, then live output) and detaches when its window
 * closes or the tab goes away; the process keeps running until it exits on its
 * own or someone kills it. That is what lets a reload put every window back
 * where it was, and what lets Overseer watch every agent at once.
 */

/** Raw output kept per console for a socket that attaches later. */
const SCROLLBACK_MAX_CHARS = 512 * 1024;

/** Output-based activity: this long without output means the CLI is idle. */
const QUIET_MS = 2_000;

/** A subscriber is a send function — one per socket. */
export type ConsoleSink = (message: ServerMessage) => void;

export interface OpenRequest {
  kind: ConsoleKind;
  projectPath: string;
  providerId?: string;
  sessionId?: string;
  resume?: boolean;
  prompt?: string;
  takeover?: boolean;
  cols: number;
  rows: number;
}

export type OpenResult =
  | { ok: true; console: ConsoleInfo; attached: boolean }
  | { ok: false; reason: string };

export type ConsoleResult = { ok: true } | { ok: false; reason: string };

interface LiveConsole {
  info: ConsoleInfo;
  handle: PtyHandle;
  /** Secret in the hook URL, so only the CLI we spawned can report for it. */
  hookToken: string;
  scrollback: string[];
  scrollbackChars: number;
  sinks: Set<ConsoleSink>;
  quietTimer?: ReturnType<typeof setTimeout>;
}

export interface ConsoleRegistryDeps {
  broadcast: (message: ServerMessage) => void;
  /** Base URL CLIs use to reach `/hooks` — loopback, same process. Absent:
   * no hooks are wired and every console uses output heuristics. */
  hookBase?: string;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  isInsideWorkspace?: (path: string) => Promise<boolean>;
  recordAction?: typeof recordAction;
  takeoverLoop?: typeof takeoverLoop;
  loopSessionIndex?: typeof loopSessionIndex;
  noteProviderSignedOut?: typeof noteProviderSignedOut;
  spawn?: typeof spawnPty;
  /** Command for a plain shell console. */
  shell?: () => { file: string; args: string[] };
  /** Command for a dev-loop console. */
  loop?: (name: string) => { file: string; args: string[]; cwd: string };
  quietMs?: number;
  now?: () => Date;
}

export interface ConsoleRegistry {
  /** Start a console — or find the one already running that session/loop.
   * Nobody is attached yet: the caller acks the id first, then attaches, so
   * the replay never reaches a client that cannot route it. */
  open(request: OpenRequest): Promise<OpenResult>;
  attach(id: string, sink: ConsoleSink, cols: number, rows: number): ConsoleResult;
  detach(id: string, sink: ConsoleSink): void;
  /** A socket went away — drop it from every console, kill nothing. */
  detachAll(sink: ConsoleSink): void;
  input(id: string, data: string): ConsoleResult;
  resize(id: string, cols: number, rows: number): ConsoleResult;
  kill(id: string): ConsoleResult;
  dismiss(id: string): ConsoleResult;
  list(): ConsoleInfo[];
  /** A CLI hook reported in. Refuses an unknown id or a wrong token. */
  reportHook(id: string, token: string, activity: string): boolean;
  /** The running console on this provider session, if any. */
  findBySession(sessionId: string): ConsoleInfo | undefined;
  /** Kill everything — server shutdown. */
  dispose(): void;
}

const ACTIVITIES = new Set<string>(["working", "waiting", "idle"]);

function defaultShell(): { file: string; args: string[] } {
  return { file: process.env.SHELL ?? "bash", args: ["-l"] };
}

/**
 * `/app/loop/run <name>` — the same entrypoint `./bin/loop <name>` execs into
 * this container from the host. Loop's own provider choice, session leasing
 * and prompt are entirely its own business.
 */
function defaultLoop(name: string): { file: string; args: string[]; cwd: string } {
  return { file: "/app/loop/run", args: [name], cwd: "/app" };
}

export function createConsoleRegistry(deps: ConsoleRegistryDeps): ConsoleRegistry {
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const isInsideWorkspaceFn = deps.isInsideWorkspace ?? isInsideWorkspace;
  const recordActionFn = deps.recordAction ?? recordAction;
  const takeoverLoopFn = deps.takeoverLoop ?? takeoverLoop;
  const loopSessionIndexFn = deps.loopSessionIndex ?? loopSessionIndex;
  const noteSignedOut = deps.noteProviderSignedOut ?? noteProviderSignedOut;
  const spawn = deps.spawn ?? spawnPty;
  const shell = deps.shell ?? defaultShell;
  const loop = deps.loop ?? defaultLoop;
  const quietMs = deps.quietMs ?? QUIET_MS;
  const now = deps.now ?? (() => new Date());

  const consoles = new Map<string, LiveConsole>();

  const list = () => [...consoles.values()].map((c) => ({ ...c.info }));
  const announceList = () => deps.broadcast({ type: "console.list", consoles: list() });

  const setActivity = (record: LiveConsole, activity: ConsoleActivity) => {
    if (record.info.activity === activity) return;
    record.info.activity = activity;
    deps.broadcast({ type: "console.state", id: record.info.id, activity });
  };

  const pushScrollback = (record: LiveConsole, data: string) => {
    record.scrollback.push(data);
    record.scrollbackChars += data.length;
    while (record.scrollbackChars > SCROLLBACK_MAX_CHARS && record.scrollback.length > 1) {
      const dropped = record.scrollback.shift()!;
      record.scrollbackChars -= dropped.length;
    }
    // One chunk bigger than the cap on its own: keep its tail.
    if (record.scrollbackChars > SCROLLBACK_MAX_CHARS) {
      const only = record.scrollback[0]!;
      record.scrollback[0] = only.slice(only.length - SCROLLBACK_MAX_CHARS);
      record.scrollbackChars = record.scrollback[0].length;
    }
  };

  /** The running console that already owns this provider session. */
  const runningOn = (sessionId: string): LiveConsole | undefined => {
    for (const record of consoles.values()) {
      if (record.info.status === "running" && record.info.sessionId === sessionId) {
        return record;
      }
    }
    return undefined;
  };

  const runningLoop = (projectPath: string): LiveConsole | undefined => {
    for (const record of consoles.values()) {
      if (
        record.info.status === "running" &&
        record.info.kind === "loop" &&
        record.info.projectPath === projectPath
      ) {
        return record;
      }
    }
    return undefined;
  };

  const attachSink = (record: LiveConsole, sink: ConsoleSink, cols: number, rows: number) => {
    record.sinks.add(sink);
    sink({ type: "console.replay", id: record.info.id, data: record.scrollback.join("") });
    if (record.info.status === "running") {
      // Last writer wins: the attaching terminal's size is the one on screen
      // now, and a TUI redraws on resize so the replay is followed by a frame
      // that fits.
      record.handle.resize(cols, rows);
    } else {
      sink({
        type: "console.exit",
        id: record.info.id,
        exitCode: record.info.exitCode ?? -1,
        ...(record.info.signal !== undefined ? { signal: record.info.signal } : {}),
      });
    }
  };

  /** Resolve what to run, or why not. */
  const resolveCommand = async (
    request: OpenRequest,
    id: string,
    hookToken: string,
  ): Promise<
    | { ok: true; command: ConsoleCommand; title: string; providerId?: string; sessionId?: string }
    | { ok: false; reason: string }
  > => {
    const name = path.basename(request.projectPath);

    if (request.kind === "shell") {
      const { file, args } = shell();
      return { ok: true, command: { file, args, cwd: request.projectPath }, title: `shell · ${name}` };
    }

    if (request.kind === "loop") {
      if (request.takeover === true) {
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
      return { ok: true, command: loop(name), title: `loop · ${name}` };
    }

    const providerId = request.providerId;
    if (providerId === undefined) return { ok: false, reason: "no provider given" };
    const adapter = getAdapterFn(providerId);
    if (adapter === undefined) return { ok: false, reason: `unknown provider: ${providerId}` };
    if (adapter.consoleCommand === undefined) {
      return { ok: false, reason: `${providerId} has no interactive console` };
    }

    let status: AdapterStatus;
    try {
      status = await adapter.getStatus();
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "could not read provider status",
      };
    }
    if (!status.authenticated) {
      await noteSignedOut(providerId, status);
      return { ok: false, reason: `${providerId} is not signed in` };
    }

    let sessionId = request.sessionId;
    const resume = request.resume === true && sessionId !== undefined;
    if (resume) {
      // A live loop run owns its transcript through a CLI that is still
      // writing it; a second CLI on the same JSONL has no lock to stop it.
      const lease = (await loopSessionIndexFn()).get(sessionId!);
      if (lease !== undefined) {
        return {
          ok: false,
          reason: `'${lease.slug}' is a live loop run — open its loop console instead`,
        };
      }
    } else if (sessionId === undefined && adapter.sessions !== undefined) {
      // Mint the id up front so the new session links to this console the
      // moment its transcript appears. A CLI that cannot adopt it ignores it.
      sessionId = await adapter.sessions.mintSessionId();
    }

    const hookUrl =
      deps.hookBase !== undefined ? `${deps.hookBase}/hooks/${id}/${hookToken}` : undefined;

    try {
      const command = await adapter.consoleCommand({
        cwd: request.projectPath,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(resume ? { resume: true } : {}),
        ...(request.prompt !== undefined && !resume ? { prompt: request.prompt } : {}),
        ...(hookUrl !== undefined ? { hookUrl } : {}),
      });
      // Only keep the id when the CLI really runs that session: a resume, or
      // a CLI that took the minted id.
      const adopted = resume || command.args.includes(sessionId ?? "\0");
      return {
        ok: true,
        command,
        title: `${providerId} · ${name}`,
        providerId,
        ...(adopted && sessionId !== undefined ? { sessionId } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "could not prepare console",
      };
    }
  };

  return {
    async open(request) {
      if (!(await isInsideWorkspaceFn(request.projectPath))) {
        return { ok: false, reason: "project is not inside the workspace" };
      }

      // One CLI per transcript: a session that is already open is attached,
      // not started a second time. Same for a project's loop run.
      const existing =
        request.kind === "agent" && request.resume === true && request.sessionId !== undefined
          ? runningOn(request.sessionId)
          : request.kind === "loop" && request.takeover !== true
            ? runningLoop(request.projectPath)
            : undefined;
      if (existing !== undefined) {
        return { ok: true, console: { ...existing.info }, attached: true };
      }

      const id = randomUUID();
      const hookToken = randomBytes(16).toString("hex");
      const resolved = await resolveCommand(request, id, hookToken);
      if (!resolved.ok) return resolved;

      let handle: PtyHandle;
      try {
        handle = await spawn({
          file: resolved.command.file,
          args: resolved.command.args,
          cwd: resolved.command.cwd,
          cols: request.cols,
          rows: request.rows,
          env: consoleEnv(resolved.command.env),
        });
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : "could not start console",
        };
      }

      const record: LiveConsole = {
        info: {
          id,
          kind: request.kind,
          projectPath: request.projectPath,
          ...(resolved.providerId !== undefined ? { providerId: resolved.providerId } : {}),
          ...(resolved.sessionId !== undefined ? { sessionId: resolved.sessionId } : {}),
          title: resolved.title,
          startedAt: now().toISOString(),
          status: "running",
          activity: "unknown",
          hooked: resolved.command.hooked === true,
        },
        handle,
        hookToken,
        scrollback: [],
        scrollbackChars: 0,
        sinks: new Set(),
      };
      consoles.set(id, record);

      handle.onData((data) => {
        pushScrollback(record, data);
        for (const target of record.sinks) target({ type: "console.output", id, data });
        if (record.info.hooked) return;
        // No hooks: output means work, silence means idle. A TUI that redraws
        // a spinner reads as working, which is what a spinner means anyway.
        setActivity(record, "working");
        if (record.quietTimer !== undefined) clearTimeout(record.quietTimer);
        record.quietTimer = setTimeout(() => setActivity(record, "idle"), quietMs);
      });

      handle.onExit((info) => {
        if (record.quietTimer !== undefined) clearTimeout(record.quietTimer);
        record.info.status = "exited";
        record.info.exitCode = info.exitCode;
        if (info.signal !== undefined) record.info.signal = info.signal;
        record.info.activity = "idle";
        for (const target of record.sinks) {
          target({
            type: "console.exit",
            id,
            exitCode: info.exitCode,
            ...(info.signal !== undefined ? { signal: info.signal } : {}),
          });
        }
        announceList();
      });

      void recordActionFn({
        actor: "operator",
        action: "console:open",
        outcome: "ok",
        detail: `${resolved.title} · ${request.projectPath}`,
      });
      announceList();
      return { ok: true, console: { ...record.info }, attached: false };
    },

    attach(id, sink, cols, rows) {
      const record = consoles.get(id);
      if (record === undefined) return { ok: false, reason: "no console with that id" };
      attachSink(record, sink, cols, rows);
      return { ok: true };
    },

    detach(id, sink) {
      consoles.get(id)?.sinks.delete(sink);
    },

    detachAll(sink) {
      for (const record of consoles.values()) record.sinks.delete(sink);
    },

    input(id, data) {
      const record = consoles.get(id);
      if (record === undefined) return { ok: false, reason: "no console with that id" };
      record.handle.write(data);
      return { ok: true };
    },

    resize(id, cols, rows) {
      const record = consoles.get(id);
      if (record === undefined) return { ok: false, reason: "no console with that id" };
      record.handle.resize(cols, rows);
      return { ok: true };
    },

    kill(id) {
      // Idempotent: killing an exited or unknown console is not an error.
      consoles.get(id)?.handle.kill();
      return { ok: true };
    },

    dismiss(id) {
      const record = consoles.get(id);
      if (record === undefined) return { ok: true };
      if (record.quietTimer !== undefined) clearTimeout(record.quietTimer);
      consoles.delete(id);
      record.handle.kill();
      announceList();
      return { ok: true };
    },

    list,

    reportHook(id, token, activity) {
      const record = consoles.get(id);
      if (record === undefined || record.hookToken !== token) return false;
      if (!ACTIVITIES.has(activity)) return false;
      if (record.info.status !== "running") return true;
      setActivity(record, activity as ConsoleActivity);
      return true;
    },

    findBySession(sessionId) {
      const record = runningOn(sessionId);
      return record === undefined ? undefined : { ...record.info };
    },

    dispose() {
      for (const record of consoles.values()) {
        if (record.quietTimer !== undefined) clearTimeout(record.quietTimer);
        record.handle.kill();
      }
      consoles.clear();
    },
  };
}

/** Map a console refusal onto the shared error frame shape. */
export function consoleError(about: string, reason: string): ErrorMessage {
  return { type: "error", about, benign: true, message: reason };
}
