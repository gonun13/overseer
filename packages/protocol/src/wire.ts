import type { AdapterStatus, LoginPhase } from "./adapter.js";
import type {
  AppliedPersonality,
  DiscoveredProject,
  DiscoveryEvent,
  DiscoveryOutcome,
  RejectedCustomization,
  UntrackedFolder,
} from "./discovery.js";

/**
 * The `/ws` envelope. Discovery is the first traffic to go over this socket,
 * but it will not be the last — the session supervisor (webui design doc §1.2)
 * routes over the same connection. So the envelope is a plain `type`-tagged
 * union with no discovery-specific framing: new families join by adding
 * variants, not by wrapping.
 */

export type PersonalityTone = NonNullable<AppliedPersonality["tone"]>;

/** UI theme — samaritan is the default; machine inverts it. Persisted in
 * internal memory the same way the active project is. */
export type OverseerTheme = "samaritan" | "machine";

export type ClientMessage =
  /** Ask the server to run a discovery pass. Explicit rather than
   * connect-time-automatic: a reconnect must not silently re-run a scan the
   * operator did not ask for, and the client needs the operations window
   * mounted before steps start arriving. */
  | { type: "discovery.run" }
  /** First-run welcome: the operator's name, stored in overseer-personality.
   * The wizard asks before discovery so the greeting can use it. */
  | { type: "operator.name"; name: string }
  /** First-run: tone chosen after the name ask — "I AM THE OVERSEER" is the
   * headline behind the picker. */
  | { type: "operator.tone"; tone: PersonalityTone }
  /** Persist the operator's active project into internal memory. */
  | { type: "project.select"; path: string }
  /** Persist the operator's theme into internal memory. */
  | { type: "theme.select"; theme: OverseerTheme }
  /** Attach a provider from the picker. Auth is a separate later step. */
  | { type: "provider.connect"; id: string }
  /** Start the provider's login. Single-flight on the server: a second asker
   * joins the flow already running rather than spawning a second one, because
   * each spawn mints its own PKCE challenge and the operator would be holding
   * a code that only the other process can redeem. */
  | { type: "auth.start"; providerId: string }
  /** The operator's paste, `<code>#<state>`. Relayed to the CLI's stdin
   * verbatim — the server does not parse, split or decode it. */
  | { type: "auth.code"; code: string }
  /** Abandon the login in flight. Nothing to say if there isn't one. */
  | { type: "auth.cancel" }
  /** `claude auth logout`. Idempotent. */
  | { type: "auth.signout"; providerId: string }
  /** Erase the overseer's memory — internal `.overseer` and the external
   * `personality.json`. Provider auth is not memory and is left alone. Only
   * sent after the operator answered the decision (ui-ux-design.md §5.2). */
  | { type: "memory.reset" }
  /**
   * Open a raw PTY into the attached provider's interactive CLI, in the active
   * project. One console per socket; a second open replaces the first.
   * `cols`/`rows` are the initial terminal size.
   */
  | { type: "console.open"; cols: number; rows: number }
  /** Keystrokes / paste from the browser terminal, opaque to Overseer. */
  | { type: "console.input"; id: string; data: string }
  /** Browser terminal resized — forwarded to the PTY. */
  | { type: "console.resize"; id: string; cols: number; rows: number }
  /** Operator dismissed the console window (or the tab is leaving). */
  | { type: "console.close"; id: string };

export interface ConnectedMessage {
  type: "connected";
  /** Server's clock at connect. The client renders time; the server owns it. */
  serverTime: string;
  /** True when this instance has a prior world snapshot — drives "welcome back". */
  returning: boolean;
  /** Accepted personality fields known before discovery (name/greeting for the
   * welcome beat). Absent fields mean unset, not "not yet asked". */
  personality?: AppliedPersonality;
  /** Theme remembered in internal memory. Absent means the samaritan default. */
  theme?: OverseerTheme;
}

export interface ErrorMessage {
  type: "error";
  /** Echoes the client message `type` that failed, when there was one. */
  about?: string;
  /**
   * True when the request was refused but nothing is broken — a duplicate
   * `discovery.run` while a pass is already in flight, a name that failed
   * validation. The client must not tear the wizard down for these. Without
   * the distinction "your other tab asked first" and "the discovery pass
   * threw" arrive as the same frame, and treating either one as the other is
   * wrong in a different direction.
   */
  benign?: boolean;
  message: string;
}

/** Ack that the operator's name was written to external memory. */
export interface OperatorNamedMessage {
  type: "operator.named";
  name: string;
}

/** Ack that the operator's tone was written to external memory. */
export interface OperatorTonedMessage {
  type: "operator.toned";
  tone: PersonalityTone;
}

/** Ack that the active project was recorded in internal memory. */
export interface ProjectSelectedMessage {
  type: "project.selected";
  path: string;
}

/** Ack that the theme was recorded in internal memory. */
export interface ThemeSelectedMessage {
  type: "theme.selected";
  theme: OverseerTheme;
}

/** Ack that a provider was attached (not necessarily authenticated). */
export interface ProviderConnectedMessage {
  type: "provider.connected";
  id: string;
}

/**
 * Fresh provider status after a background usage refresh (or any later
 * re-check that is not a login). Discovery and `auth.state` still carry status
 * inline; this frame is for updates that arrive after furniture is up.
 */
export interface ProviderStatusMessage {
  type: "provider.status";
  id: string;
  status: AdapterStatus;
}

/**
 * The whole state of the login flow in one frame.
 *
 * One state frame rather than a stream of deltas: a tab that connects (or asks)
 * mid-flow has to be handed the whole picture in a single message, which is
 * what joining an in-flight login instead of refusing it requires.
 *
 * Always broadcast, never sent to one socket — a login finished in one tab has
 * to land in all of them.
 */
export interface AuthStateMessage {
  type: "auth.state";
  providerId: string;
  phase: "idle" | LoginPhase;
  /**
   * Present from `awaiting-code` on. The operator clicks it in *their* browser,
   * on their own machine; the container never opens anything and there is no
   * callback for a browser to reach.
   *
   * Carries a PKCE challenge — a secret. It goes to the operator's screen and
   * nowhere else: not the run logs, not the action register, not the
   * operations window.
   */
  verificationUrl?: string;
  /** Operator-facing reason when `phase === "failed"`, in the CLI's own words. */
  detail?: string;
  /** True when the CLI is still at the prompt and another code may be pasted. */
  retryable?: boolean;
  /** Refreshed status once the flow settles — same shape discovery reports, so
   * `DiscoveredProvider.status` and this frame never diverge. */
  status?: AdapterStatus;
}

/** Live workspace project list from the monitor worker — create/delete under
 * `/workspace`, not a full discovery pass. */
export interface WorkspaceProjectsMessage {
  type: "workspace.projects";
  projects: DiscoveredProject[];
  /** Direct children of `/workspace` that are not git projects. */
  untrackedFolders: UntrackedFolder[];
  /** Present when the previous active project vanished and the server picked
   * a replacement (or cleared). Omitted when the active path is unchanged. */
  activeProjectPath?: string;
  /** Accepted personality after a change. Empty object means defaults / gone. */
  personality?: AppliedPersonality;
  /** Refusals from a live re-read of `personality.json`. */
  rejected?: RejectedCustomization[];
  /** True when personality was deleted while running. The client
   * must ask for a restart — the monitor does not recreate it live. */
  personalityMissing?: true;
}

/** One line for the operations window from a supervisor worker (not discovery).
 * Same telegraphic shape as discovery steps — the window does not care who
 * authored the line (docs/overseer.md §3). */
export interface OverseerStepMessage {
  type: "overseer.step";
  id: string;
  label: string;
  outcome: DiscoveryOutcome;
  detail?: string;
}

/** Every store named by `memory.reset` is gone. The steps of the wipe arrived
 * as ordinary `overseer.step` lines; this is only the end of them, and the
 * client's cue to reload into a first run. */
export interface MemoryResetDoneMessage {
  type: "memory.reset.done";
}

/** PTY is up — subsequent input/resize/close must carry this `id`. */
export interface ConsoleOpenedMessage {
  type: "console.opened";
  id: string;
}

/** Opaque PTY output chunk for the owning socket only. */
export interface ConsoleOutputMessage {
  type: "console.output";
  id: string;
  data: string;
}

/**
 * The CLI process ended. Native `/exit` and `/quit` land here; the client
 * closes the console window. `signal` is present when the process was killed.
 */
export interface ConsoleExitMessage {
  type: "console.exit";
  id: string;
  exitCode: number;
  signal?: number;
}

export type ServerMessage =
  | ConnectedMessage
  | ErrorMessage
  | OperatorNamedMessage
  | OperatorTonedMessage
  | ProjectSelectedMessage
  | ThemeSelectedMessage
  | ProviderConnectedMessage
  | ProviderStatusMessage
  | AuthStateMessage
  | WorkspaceProjectsMessage
  | OverseerStepMessage
  | MemoryResetDoneMessage
  | ConsoleOpenedMessage
  | ConsoleOutputMessage
  | ConsoleExitMessage
  | DiscoveryEvent;

/** Hard caps so a malformed frame cannot pin memory or a PTY. */
export const CONSOLE_MAX_COLS = 500;
export const CONSOLE_MAX_ROWS = 200;
export const CONSOLE_MAX_INPUT_CHARS = 64_000;

function isConsoleSize(cols: unknown, rows: unknown): boolean {
  return (
    typeof cols === "number" &&
    typeof rows === "number" &&
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= 1 &&
    rows >= 1 &&
    cols <= CONSOLE_MAX_COLS &&
    rows <= CONSOLE_MAX_ROWS
  );
}

const TONES = new Set<string>(["neutral", "dry", "warm"]);
const THEMES = new Set<string>(["samaritan", "machine"]);

/** Narrows an unknown parsed frame to a client message. The socket is a trust
 * boundary even on loopback — nothing downstream should be casting. */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (type === "discovery.run") return true;
  if (type === "operator.name") {
    return typeof (value as { name?: unknown }).name === "string";
  }
  if (type === "operator.tone") {
    return TONES.has((value as { tone?: unknown }).tone as string);
  }
  if (type === "project.select") {
    return typeof (value as { path?: unknown }).path === "string";
  }
  if (type === "theme.select") {
    return THEMES.has((value as { theme?: unknown }).theme as string);
  }
  if (type === "provider.connect") {
    return typeof (value as { id?: unknown }).id === "string";
  }
  if (type === "auth.start" || type === "auth.signout") {
    return typeof (value as { providerId?: unknown }).providerId === "string";
  }
  if (type === "auth.code") {
    // Only that it is a string. The shape of a code is the CLI's business —
    // anything stricter here would be this process guessing at a format it does
    // not own, and rejecting a valid paste is indistinguishable to the operator
    // from a broken login.
    return typeof (value as { code?: unknown }).code === "string";
  }
  if (type === "auth.cancel") return true;
  if (type === "memory.reset") return true;
  if (type === "console.open") {
    const msg = value as { cols?: unknown; rows?: unknown };
    return isConsoleSize(msg.cols, msg.rows);
  }
  if (type === "console.input") {
    const msg = value as { id?: unknown; data?: unknown };
    return (
      typeof msg.id === "string" &&
      msg.id.length > 0 &&
      msg.id.length <= 64 &&
      typeof msg.data === "string" &&
      msg.data.length <= CONSOLE_MAX_INPUT_CHARS
    );
  }
  if (type === "console.resize") {
    const msg = value as { id?: unknown; cols?: unknown; rows?: unknown };
    return (
      typeof msg.id === "string" &&
      msg.id.length > 0 &&
      msg.id.length <= 64 &&
      isConsoleSize(msg.cols, msg.rows)
    );
  }
  if (type === "console.close") {
    const msg = value as { id?: unknown };
    return (
      typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 64
    );
  }
  return false;
}
