/** What the UI may offer for a provider — an adapter that can't do X doesn't
 * grow an X control. Everything an agent does happens in its own CLI, so this
 * is only about the parts Overseer drives itself. */
export interface AdapterCapabilities {
  /** Whether this adapter can sign itself in from the console. False means the
   * UI grows no login controls at all — an adapter that authenticates some
   * other way must not be handed a dead button. */
  login: boolean;
  /**
   * Whether this adapter offers `checkUsage` — an on-demand, operator-
   * triggered usage report. False means the UI grows no "check usage" button,
   * rather than offering one that always fails.
   */
  usageCheck: boolean;
}

/** One provider session, as its transcript on disk describes it. */
export interface SessionMeta {
  id: string;
  adapterId: string;
  name?: string;
  projectDir: string;
  gitBranch?: string;
  status: "live" | "dormant" | "closed";
  createdAt: string;
  lastActiveAt: string;
  totalCostUsd: number;
  /**
   * Set when this session is a dev-loop run rather than one the app started.
   * The loop mints its own id and records it in its lease, so the *supervisor*
   * stamps this by cross-referencing that lease — an adapter never learns what
   * a loop is (spec/architecture.md's provider/adapter split).
   *
   * A loop session must never be resumed: its transcript belongs to a live
   * interactive PTY, and a second CLI writing the same JSONL corrupts it.
   */
  origin?: "loop";
  /** Workspace slug whose lease owns this run. Only set with `origin: "loop"`. */
  loopWorkspace?: string;
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
 * Result of an on-demand `checkUsage` ask (see `AgentAdapter.checkUsage`).
 *
 * `report` is the adapter's own prose, kept verbatim — it is the receipt for
 * `windows`, and the only thing to show when nothing could be read out of it.
 * `windows` is a best-effort parse of that prose: the shape is not guaranteed
 * stable across runs (an adapter may be reading a model's own write-up), so
 * an unreadable report yields an empty list rather than a placeholder 0%.
 */
export type AdapterUsageCheck =
  | {
      ok: true;
      report: string;
      /** Gauges read out of `report`. Empty when its shape defeated the parse. */
      windows: AdapterUsageWindow[];
      /** Spend for the cycle, in the provider's own words (e.g. `$45.13`). */
      spend?: string;
    }
  | { ok: false; reason: string };

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
 * Options for an interactive provider CLI console — the provider's own TUI in
 * a PTY. Every agent interaction in Overseer goes through one of these.
 */
export interface ConsoleOpts {
  /** Absolute path inside `/workspace` — the CLI's cwd. */
  cwd: string;
  /**
   * The provider session this console runs. With `resume` it is an existing
   * session to pick up; without, it is a freshly minted id the CLI should
   * adopt for a new session (when the CLI supports choosing one). Absent:
   * the CLI starts a session of its own choosing.
   */
  sessionId?: string;
  resume?: boolean;
  /** Opening prompt for a new session, passed as the CLI's positional
   * argument so the TUI starts on it. */
  prompt?: string;
  /**
   * Where the CLI should report lifecycle events (prompt submitted, tool use,
   * waiting on a permission, turn done) — an HTTP endpoint on this server.
   * Adapters whose CLI has hooks wire them to it; others ignore it and the
   * server falls back to watching PTY output.
   */
  hookUrl?: string;
}

/**
 * What to run for a console. The server owns the PTY; the adapter only knows
 * its CLI's command line, so spawning, scrollback and lifetime live in one
 * place for every provider.
 */
export interface ConsoleCommand {
  file: string;
  args: string[];
  cwd: string;
  /** Added on top of the server's environment. */
  env?: Record<string, string>;
  /** True when `hookUrl` was wired into the CLI — the server then trusts hook
   * events over output-based activity guessing. */
  hooked?: boolean;
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

/**
 * Where an adapter's own session transcripts live, for the server to list,
 * title and delete them without knowing the on-disk format.
 *
 * `mintSessionId` is `Promise`-returning to leave room for a provider whose
 * id must round-trip its own CLI — neither shipped adapter needs that today:
 * both mint locally with `randomUUID()` and pass it to the CLI (claude's
 * `--session-id`, cursor's `--resume`, which accepts an id it has never seen).
 */
export interface AdapterSessionStore {
  /** Every session this adapter's own transcripts show for one project. */
  listProjectSessions(projectDir: string): Promise<SessionMeta[]>;
  mintSessionId(): Promise<string>;
  lookupSessionTitle(projectDir: string, sessionId: string): Promise<string | undefined>;
  deleteSession(projectDir: string, sessionId: string): Promise<void>;
}

export interface AgentAdapter {
  id: string;
  capabilities: AdapterCapabilities;
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
   * On-demand usage report as the CLI's own prose, for an adapter whose only
   * usage surface is a real agent turn rather than a free deterministic
   * command (cursor's `/usage` is an ordinary prompt the model answers, not a
   * client-intercepted report — real tokens, real latency, no fixed shape).
   * Never scheduled automatically and never parsed into `AdapterUsageWindow`
   * gauges the way `refreshUsage` is — only asked when the operator asks.
   * Absent when the adapter has no such path. Never throws.
   */
  checkUsage?(opts: { projectDir: string }): Promise<AdapterUsageCheck>;
  /** Present only when `capabilities.login` is true. */
  login?: AdapterLogin;
  /**
   * The command line for an interactive console. Absent when the adapter has
   * no interactive CLI — the server must refuse `console.open` in that case
   * rather than invent a pipe. May prepare CLI state (onboarding flags, trust)
   * before returning.
   */
  consoleCommand?(opts: ConsoleOpts): Promise<ConsoleCommand>;
  /**
   * Directory the adapter writes session transcripts under, for the server to
   * watch so a session started in any console reaches the list. Absent when the
   * adapter keeps no such directory, in which case nothing is watched — the
   * server must not guess a path, because where a CLI keeps its state is the
   * adapter's business (the same reasoning `CLAUDE_CONFIG_DIR` carries).
   */
  sessionsWatchPath?(): string | undefined;
  /**
   * Where this adapter's own session transcripts live, for the server to
   * list, title and delete without knowing the on-disk format. Absent for a
   * catalog stub — `getStatus` always reports `authenticated: false` there,
   * so nothing reaches past that to ask for a session store.
   */
  sessions?: AdapterSessionStore;
}
