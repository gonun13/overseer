import type { AgentEvent } from "./events.js";

/** Flag set the UI renders controls from — an adapter that can't do X doesn't grow an X zone. */
export interface AdapterCapabilities {
  streamingDeltas: boolean;
  permissionPrompts: boolean;
  interrupt: boolean;
  subagents: boolean;
  mcp: boolean;
  skills: boolean;
  effortLevels: boolean;
  costReporting: boolean;
  checkpoints: boolean;
  backgroundAgents: boolean;
  /** Whether this adapter can sign itself in from the console. False means the
   * UI grows no login controls at all — an adapter that authenticates some
   * other way must not be handed a dead button. */
  login: boolean;
}

/**
 * The permission modes a provider CLI accepts. These are claude 2.1.226's own
 * six choices, as it prints them when handed a bogus one:
 *
 *   error: option '--permission-mode <mode>' argument 'x' is invalid.
 *   Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.
 *
 * The CLI also accepts an undocumented `default`, and reports `manual` back as
 * `default`. That asymmetry is the adapter's to absorb (see
 * `normalizePermissionMode` in the claude-code adapter) — it must not leak into
 * the union, or the UI ends up offering the operator two words for one mode.
 */
export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "manual"
  | "dontAsk"
  | "plan";

export type PermissionDecision =
  | { decision: "allow-once" }
  | { decision: "allow-always"; rule: string }
  | { decision: "deny"; feedback?: string };

export interface SessionOpts {
  projectDir: string;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  /** Subagent to run the turn as. Empty or absent means the agent itself. */
  agent?: string;
  resumeSessionId?: string;
  name?: string;
}

/**
 * One entry in a session-control menu.
 *
 * `value` is what reaches the CLI; `label` and `detail` are the provider's own
 * words for it. Nothing here is composed by Overseer — when a provider gives no
 * display name, `label` repeats `value` rather than inventing prose.
 */
export interface ProviderOption {
  value: string;
  label: string;
  detail?: string;
  /** Arms something dangerous (`bypassPermissions`). Rendered in `--accent`. */
  danger?: true;
  /**
   * For a model row only: the id the CLI actually reports once this model is
   * running (`"sonnet"` resolves to `"claude-sonnet-5"`). A live session's
   * `SessionMeta.model`/turn attribution carries that resolved id, not the
   * menu's own `value` — matching against this is how the UI turns it back
   * into the catalog entry instead of printing the raw id.
   */
  resolvedModel?: string;
}

/**
 * What one provider offers a session, in one project. Agents are project-scoped
 * (`<project>/.claude/agents/`), so this is asked per project directory rather
 * than once per provider.
 *
 * Every list may be empty: an adapter that could not get an answer reports
 * nothing rather than a guess, and the UI leaves that row's menu shut.
 */
export interface ProviderOptions {
  models: ProviderOption[];
  permissionModes: ProviderOption[];
  agents: ProviderOption[];
  /** The mode the CLI is configured to use when none is passed. */
  defaultPermissionMode?: PermissionMode;
  /** The model the CLI is configured to use when none is passed. Lets a control
   * row read what the next turn will actually run on instead of a blank. */
  defaultModel?: string;
}

export interface SessionMeta {
  id: string;
  adapterId: string;
  name?: string;
  projectDir: string;
  gitBranch?: string;
  model: string;
  /** Absent until the provider reports it on `session.init` — the same "not
   * told yet" convention `model: ""` uses. Never filled with a plausible
   * default: the CLI's own settings decide, and guessing here would show the
   * operator a mode the session is not actually running under. */
  permissionMode?: PermissionMode;
  status: "live" | "dormant" | "closed";
  createdAt: string;
  lastActiveAt: string;
  totalCostUsd: number;
  /**
   * Set when this session is a dev-loop run rather than one the app started.
   * The loop mints its own id and records it in its lease, so the *supervisor*
   * stamps this by cross-referencing that lease — an adapter never learns what
   * a loop is (docs/architecture-design.md's provider/adapter split).
   *
   * A loop session must never be resumed: its transcript belongs to a live
   * interactive PTY, and a second CLI writing the same JSONL corrupts it.
   */
  origin?: "loop";
  /** Workspace slug whose lease owns this run. Only set with `origin: "loop"`. */
  loopWorkspace?: string;
}

export interface UserMessage {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: string; mediaType: string }
  >;
}

export interface SessionHandle {
  events: AsyncIterable<AgentEvent>;
  /** Queues if a turn is in flight. */
  send(msg: UserMessage): void;
  interrupt(): void;
  /** Retarget the *next* turn of this already-running session — a control
   * request on stdin, not a respawn. Success or failure comes back as a
   * `session.model` or `error` event on `events`, asynchronously. */
  setModel(model: string): void;
  resolvePermission(id: string, decision: PermissionDecision): void;
  close(): Promise<void>;
}

/**
 * One subscription quota window the adapter was able to read. Absent windows
 * are omitted — never filled in with a placeholder 0.
 *
 * `session` is Claude's short rolling window (five hours, labelled "Current
 * session" by the CLI). `week` is the weekly all-models cap. Extra caps such
 * as a per-model weekly pool use `week:<name>`.
 */
export interface AdapterUsageWindow {
  /** Stable id: `session`, `week`, or `week:<model>` for extra caps. */
  id: string;
  /** Operator-facing name, lowercase: `session`, `week`, `fable`. */
  label: string;
  /** Fraction consumed, 0–1 inclusive. */
  used: number;
  /** The CLI's own reset phrase, when it gave one. Not parsed into a date. */
  resets?: string;
}

/**
 * How the subscription-window read went. Only set when `authenticated` is true
 * — signed-out statuses omit it, the same way they omit `usage`.
 *
 * Auth and usage fail separately: discovery must learn "signed in" without
 * waiting on a hung `/usage`, so `getStatus` returns `pending` and a later
 * `refreshUsage` moves to `ready` or `unavailable`.
 */
export type AdapterUsageState = "pending" | "ready" | "unavailable";

/**
 * Whether this adapter could actually start a session right now. Asked before
 * any session exists — the wizard's auth-check step calls this, so it must not
 * assume a session, a project or a running process.
 *
 * `detail` is the operator-facing half: "not logged in" and "token expired" are
 * both `authenticated: false` and want different actions. Left undefined when
 * there is nothing to add beyond the flag.
 *
 * `reachable` is separate from auth: the CLI missing or not answering is not
 * "please sign in", it is a red light. Omit or `true` when the runtime answered;
 * `false` when it could not be contacted or its reply was unusable.
 */
export interface AdapterStatus {
  authenticated: boolean;
  detail?: string;
  /** False when the provider runtime could not be reached. Omit when it could. */
  reachable?: boolean;
  /** The adapter's own version, when it can report one. Never guessed. */
  version?: string;
  /** Subscription windows, when the adapter has a real reading. */
  usage?: AdapterUsageWindow[];
  /** Present when signed in. Omitted when signed out. */
  usageState?: AdapterUsageState;
}

/**
 * Where a login has got to. The same five words the server puts on the wire —
 * the adapter owns the machine, the server only relays it, so there is one
 * definition rather than two that can drift.
 *
 * `verifying` is entered when a code is submitted and left again when the CLI
 * rejects it: a rejected code is not the end of the flow, it is a return to
 * `awaiting-code` with a reason attached.
 */
export type LoginPhase =
  | "starting"
  | "awaiting-code"
  | "verifying"
  | "success"
  | "failed";

export interface LoginUpdate {
  phase: LoginPhase;
  /**
   * Present from `awaiting-code` on. Opened in the *operator's* browser, on the
   * operator's machine — the container is headless and never opens anything.
   *
   * Carries a PKCE challenge. It is a secret: it must not be logged.
   */
  verificationUrl?: string;
  /** Operator-facing reason, in the CLI's own words, when something failed. */
  detail?: string;
  /** True when the CLI is still at its prompt and another code may be pasted. */
  retryable?: boolean;
  /** Set on the terminal update — the re-checked status, never the exit code. */
  status?: AdapterStatus;
}

export interface LoginHandle {
  /**
   * The operator's paste, passed to the CLI's stdin verbatim.
   *
   * The value is `<code>#<state>`. Implementations must not split it on `#`,
   * URL-decode it, or lowercase it — the CLI validates the shape locally and
   * refuses a mangled paste with a message that blames the operator.
   */
  submitCode(code: string): void;
  /** Give up on this login and tear the child down. */
  cancel(): void;
  /**
   * Settles when the child has ended *and* the adapter has re-asked what its
   * real auth status is. Never derived from the exit code: cancel and success
   * both exit 0.
   */
  done: Promise<AdapterStatus>;
}

export interface AdapterLogin {
  /** Starts one login. `onUpdate` fires for every phase change, including the
   * terminal one, before `done` settles. */
  start(onUpdate: (update: LoginUpdate) => void): LoginHandle;
  /** Idempotent — signing out when already signed out is not an error. */
  signOut(): Promise<void>;
}

/**
 * Options for the raw CLI console — a PTY escape hatch into the provider's
 * interactive CLI, not a stream-json agent session.
 */
export interface ConsoleOpts {
  /** Absolute path inside `/workspace` — the CLI's cwd. */
  cwd: string;
  cols: number;
  rows: number;
}

export interface ConsoleExit {
  exitCode: number;
  /** Present when the process ended on a signal rather than an exit code. */
  signal?: number;
}

/**
 * One live provider-CLI PTY. I/O is opaque bytes as strings: Overseer does not
 * interpret slash commands, ANSI, or prompts — that is the CLI's job.
 */
export interface ConsoleHandle {
  onData(listener: (data: string) => void): void;
  onExit(listener: (info: ConsoleExit) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /**
   * Ask the child to die. Idempotent. Implementations escalate from a graceful
   * signal to a forced kill so a wedged CLI cannot pin the console slot.
   */
  kill(): void;
  /** Settles once the process has exited. Never rejects. */
  done: Promise<ConsoleExit>;
}

export interface AgentAdapter {
  id: string;
  capabilities: AdapterCapabilities;
  createSession(opts: SessionOpts): Promise<SessionHandle>;
  resumeSession(id: string): Promise<SessionHandle>;
  listSessions(): Promise<SessionMeta[]>;
  /**
   * Auth (and version) only — must not wait on usage. When signed in, returns
   * `usageState: "pending"` so the widget can say it is retrieving. Never throws.
   */
  getStatus(): Promise<AdapterStatus>;
  /**
   * Re-ask subscription windows. Absent when the adapter has no usage report.
   * Resolves to `usageState: "ready" | "unavailable"`; never throws.
   */
  refreshUsage?(): Promise<AdapterStatus>;
  /**
   * What this provider offers a session in one project — models, permission
   * modes, subagents. Absent when the adapter cannot enumerate them, in which
   * case the server refuses the request rather than filling the menus in with
   * plausible-looking values. Never throws; empty lists are the failure shape.
   */
  listOptions?(opts: { projectDir: string }): Promise<ProviderOptions>;
  /** Present only when `capabilities.login` is true. */
  login?: AdapterLogin;
  /**
   * Open a raw interactive CLI console. Absent when the adapter has no PTY
   * escape hatch — the server must refuse `console.open` in that case rather
   * than invent a pipe.
   */
  openConsole?(opts: ConsoleOpts): Promise<ConsoleHandle>;
  /**
   * Directory the adapter writes session transcripts under, for the server to
   * watch so sessions it did not start still reach the list. Absent when the
   * adapter keeps no such directory, in which case nothing is watched — the
   * server must not guess a path, because where a CLI keeps its state is the
   * adapter's business (the same reasoning `CLAUDE_CONFIG_DIR` carries).
   */
  sessionsWatchPath?(): string | undefined;
}
