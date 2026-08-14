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

export type PermissionMode =
  "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type PermissionDecision =
  | { decision: "allow-once" }
  | { decision: "allow-always"; rule: string }
  | { decision: "deny"; feedback?: string };

export interface SessionOpts {
  projectDir: string;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  resumeSessionId?: string;
  name?: string;
}

export interface SessionMeta {
  id: string;
  adapterId: string;
  name?: string;
  projectDir: string;
  gitBranch?: string;
  model: string;
  permissionMode: PermissionMode;
  status: "live" | "dormant" | "closed";
  createdAt: string;
  lastActiveAt: string;
  totalCostUsd: number;
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
  resolvePermission(id: string, decision: PermissionDecision): void;
  close(): Promise<void>;
}

/**
 * Whether this adapter could actually start a session right now. Asked before
 * any session exists — the wizard's auth-check step calls this, so it must not
 * assume a session, a project or a running process.
 *
 * `detail` is the operator-facing half: "not logged in" and "token expired" are
 * both `authenticated: false` and want different actions. Left undefined when
 * there is nothing to add beyond the flag.
 */
export interface AdapterStatus {
  authenticated: boolean;
  detail?: string;
  /** The adapter's own version, when it can report one. Never guessed. */
  version?: string;
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

export interface AgentAdapter {
  id: string;
  capabilities: AdapterCapabilities;
  createSession(opts: SessionOpts): Promise<SessionHandle>;
  resumeSession(id: string): Promise<SessionHandle>;
  listSessions(): Promise<SessionMeta[]>;
  /** Must resolve rather than throw: a failed check is a status, not an error. */
  getStatus(): Promise<AdapterStatus>;
  /** Present only when `capabilities.login` is true. */
  login?: AdapterLogin;
}
