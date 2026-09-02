import type {
  AdapterStatus,
  AdapterUsageWindow,
  LoginPhase,
  PermissionMode,
  ProviderOption,
  ProviderOptions,
  SessionMeta,
} from "./adapter.js";
import type { AgentEvent } from "./events.js";
import type { TurnWire } from "./transcript.js";
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
  /** Ask what the attached provider offers a session in the active project —
   * models, permission modes, subagents. Explicit rather than pushed at
   * connect time: the answer costs a subprocess, and only a client with the
   * controls on screen needs it. */
  | { type: "provider.options" }
  /**
   * Ask the attached provider for an on-demand usage report (`AgentAdapter
   * .checkUsage`) — the operator's own request, never sent automatically.
   * Unlike `provider.options`, some adapters answer this with a real,
   * possibly slow, possibly costly CLI turn (cursor's `/usage` is an ordinary
   * prompt the model answers, not a free deterministic command), so it is
   * gated behind an explicit ask rather than run on any timer.
   */
  | { type: "provider.checkUsage" }
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
   * `cols`/`rows` are the initial terminal size. `mode: "loop"` opens the dev
   * loop's overseer session (`loop/run`) instead of the bare provider CLI.
   */
  | {
      type: "console.open";
      cols: number;
      rows: number;
      mode?: "loop";
      /**
       * End the loop run currently holding this workspace's lease before
       * starting a new one. Only meaningful with `mode: "loop"`, and only sent
       * after the operator answered a decision — it destroys a conversation
       * that may be mid-request, possibly one attached to another terminal.
       */
      takeover?: boolean;
    }
  /** Keystrokes / paste from the browser terminal, opaque to Overseer. */
  | { type: "console.input"; id: string; data: string }
  /** Browser terminal resized — forwarded to the PTY. */
  | { type: "console.resize"; id: string; cols: number; rows: number }
  /** Operator dismissed the console window (or the tab is leaving). */
  | { type: "console.close"; id: string }
  /** List sessions for the active project. */
  | { type: "session.list" }
  /** Start a new stream-json session in the active project. */
  | {
      type: "session.create";
      model?: string;
      permissionMode?: PermissionMode;
      /** Subagent to run turns as. Empty string means none — the operator
       * chose the "none" row, which is not the same as never having chosen. */
      agent?: string;
      name?: string;
    }
  /** Subscribe to a session, backfill history, resume if dormant. */
  | { type: "session.open"; sessionId: string }
  /** Send a user turn to a live session. */
  | { type: "session.send"; sessionId: string; text: string }
  /** Retarget an already-running session's next turn — a control request on
   * the live process, not a respawn. Resumes a dormant session first, the
   * same as `session.send`. */
  | { type: "session.model"; sessionId: string; model: string }
  /** Interrupt the in-flight turn. */
  | { type: "session.interrupt"; sessionId: string }
  /** Close a live session process. */
  | { type: "session.close"; sessionId: string }
  /** Stop the process if running and permanently delete the session's transcript. */
  | { type: "session.delete"; sessionId: string }
  /**
   * Read the loop's own provider/model configuration — separate from the
   * app's single attached provider (`provider.connect`); the loop picks its
   * own (`loop/.provider`) and is configured independently. Explicit rather
   * than pushed at connect time: it shells out to `loop/bin/models`, and
   * only a client with the loop tab of the providers window open needs it.
   */
  | { type: "loop.config.read" }
  /** Select which provider the loop runs on next (`loop/bin/provider`). */
  | { type: "loop.provider.set"; id: string }
  /**
   * Set one model slot for one loop-runnable provider (`loop/bin/models
   * set`). `slot` is a step name or the literal `"overseer"`; the server
   * validates it against the live step list, not this frame — the loop's
   * `db.sh` is the source of truth for what a step is. `model` empty clears
   * the slot back to inherit.
   */
  | { type: "loop.model.set"; providerId: string; slot: string; model: string }
  /**
   * The models one loop-runnable provider actually offers — `loop/bin/models
   * list-models <providerId>`, which asks that provider's own CLI directly
   * (each bundle's `provider_list_models`). Deliberately independent of the
   * app's single attached provider: the loop's own provider is configured
   * separately, so the model list for it must not be limited to whichever
   * one the app happens to be attached to.
   */
  | { type: "loop.models.read"; providerId: string };

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
 * Reply to `provider.checkUsage` (see `AdapterUsageCheck`): `windows` are the
 * gauges the widget draws, `report` the prose they were read out of — kept so
 * an unreadable report still has something to show, and so the numbers on the
 * instrument always have a receipt behind them.
 *
 * Broadcast, same reasoning as `ProviderOptionsMessage`: the ask can be slow
 * and costly, so a second tab must not trigger a second one just to see the
 * answer that is already on its way.
 */
export interface ProviderUsageCheckMessage {
  type: "provider.usageCheck";
  id: string;
  report: string;
  windows: AdapterUsageWindow[];
  spend?: string;
}

/**
 * What the attached provider offers a session, for one project.
 *
 * Broadcast rather than sent to the asking socket: the answer is a fact about
 * the instance, not about who asked, and a second tab must not have to spawn
 * the CLI again to learn it.
 *
 * `projectDir` is on the frame because the lists are project-scoped — a client
 * that has already moved on to another project can tell this reply is stale
 * instead of rendering another project's subagents.
 */
export interface ProviderOptionsMessage {
  type: "provider.options";
  providerId: string;
  projectDir: string;
  options: ProviderOptions;
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
  /** Echoes the open request's mode. The raw CLI and the dev loop hold a PTY
   * slot each, so a socket can have two console windows live at once; without
   * this each of them would adopt whichever ack landed last. */
  mode?: "loop";
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

/** Sessions for the active project — broadcast to all tabs. */
export interface SessionListMessage {
  type: "session.list";
  sessions: SessionMeta[];
}

/** JSONL backfill before live streaming begins. */
export interface SessionHistoryMessage {
  type: "session.history";
  sessionId: string;
  turns: TurnWire[];
}

/** One normalized adapter event from a live session. */
export interface SessionEventMessage {
  type: "session.event";
  event: AgentEvent;
}

/** Session metadata changed (status, cost, name). */
export interface SessionMetaMessage {
  type: "session.meta";
  session: SessionMeta;
}

/** One loop-runnable provider's model allocation, mirroring `loop/bin/models
 * --json`'s `providers.<id>` entry. */
export interface LoopProviderInfo {
  id: string;
  /** Mirrors `providers/<id>/manifest.json`'s `loopSubagents` field (absent
   * there reads as verified) — false means this provider runs every step
   * itself, regardless of any model configured below, until a model is
   * confirmed to actually delegate. See `loop/overseer.md`'s
   * `subagents_available` rule, which is what this field describes. */
  subagentsVerified: boolean;
  overseer: string | null;
  steps: Record<string, string | null>;
}

/** The loop's own provider/model configuration — broadcast, not sent to one
 * socket, so every tab with the loop tab open stays in sync after another
 * one changes it. Separate from `DiscoveredProvider`/`provider.status`:
 * the loop's provider selection and the app's attached provider are
 * independent (docs/architecture-design.md §9). */
export interface LoopConfigMessage {
  type: "loop.config";
  /** `loop/.provider` — the provider the loop runs on next. */
  current: string;
  /** Every provider the loop can run (manifest `loop: "bundle"`). */
  providers: LoopProviderInfo[];
  /** Step names in loop order — `loop/bin/lib/db.sh`'s `step_names`, read
   * once here rather than duplicated in this union. */
  steps: string[];
}

/**
 * The models one loop-runnable provider offers, from `loop/bin/models
 * list-models <providerId>` — that provider's own CLI, asked directly and
 * independent of the app's attached provider (unlike `ProviderOptionsMessage`,
 * which only ever answers for the one the app has attached and authenticated).
 * Broadcast, so a provider switched from another tab still lands here.
 */
export interface LoopModelsMessage {
  type: "loop.models";
  providerId: string;
  models: ProviderOption[];
  defaultModel?: string;
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
  | ProviderUsageCheckMessage
  | ProviderOptionsMessage
  | AuthStateMessage
  | WorkspaceProjectsMessage
  | OverseerStepMessage
  | MemoryResetDoneMessage
  | ConsoleOpenedMessage
  | ConsoleOutputMessage
  | ConsoleExitMessage
  | SessionListMessage
  | SessionHistoryMessage
  | SessionEventMessage
  | SessionMetaMessage
  | LoopConfigMessage
  | LoopModelsMessage
  | DiscoveryEvent;

/** Hard caps so a malformed frame cannot pin memory or a PTY. */
export const CONSOLE_MAX_COLS = 500;
export const CONSOLE_MAX_ROWS = 200;
export const CONSOLE_MAX_INPUT_CHARS = 64_000;
export const SESSION_MAX_ID_CHARS = 64;
export const SESSION_MAX_TEXT_CHARS = 64_000;
export const SESSION_MAX_NAME_CHARS = 256;
/** Matches `SESSION_MAX_AGENT_CHARS` — a menu value, not free text. */
export const SESSION_MAX_MODEL_CHARS = 128;

/** Mirrors `PermissionMode`. The CLI rejects anything else outright, and a
 * rejected spawn reads to the operator as a broken session rather than a bad
 * frame — so the socket refuses it here instead. */
const PERMISSION_MODES = new Set<string>([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "manual",
  "dontAsk",
  "plan",
  "ask",
]);

/** A subagent name, as the provider reported it. Empty means "none". */
export const SESSION_MAX_AGENT_CHARS = 128;

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
  if (type === "provider.options") return true;
  if (type === "provider.checkUsage") return true;
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
  if (type === "session.list") return true;
  if (type === "session.create") {
    const msg = value as {
      model?: unknown;
      permissionMode?: unknown;
      agent?: unknown;
      name?: unknown;
    };
    if (msg.model !== undefined && typeof msg.model !== "string") return false;
    if (
      msg.permissionMode !== undefined &&
      !PERMISSION_MODES.has(msg.permissionMode as string)
    ) {
      return false;
    }
    // An empty agent is legal — it is the "none" row, and it must be
    // distinguishable from the field never having been sent.
    if (
      msg.agent !== undefined &&
      (typeof msg.agent !== "string" ||
        msg.agent.length > SESSION_MAX_AGENT_CHARS)
    ) {
      return false;
    }
    if (msg.name !== undefined) {
      return (
        typeof msg.name === "string" &&
        msg.name.length > 0 &&
        msg.name.length <= SESSION_MAX_NAME_CHARS
      );
    }
    return true;
  }
  if (
    type === "session.open" ||
    type === "session.interrupt" ||
    type === "session.close" ||
    type === "session.delete"
  ) {
    const msg = value as { sessionId?: unknown };
    return isSessionId(msg.sessionId);
  }
  if (type === "session.send") {
    const msg = value as { sessionId?: unknown; text?: unknown };
    return (
      isSessionId(msg.sessionId) &&
      typeof msg.text === "string" &&
      msg.text.length > 0 &&
      msg.text.length <= SESSION_MAX_TEXT_CHARS
    );
  }
  if (type === "session.model") {
    const msg = value as { sessionId?: unknown; model?: unknown };
    return (
      isSessionId(msg.sessionId) &&
      typeof msg.model === "string" &&
      msg.model.length > 0 &&
      msg.model.length <= SESSION_MAX_MODEL_CHARS
    );
  }
  if (type === "loop.config.read") return true;
  if (type === "loop.provider.set") {
    const msg = value as { id?: unknown };
    return typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 64;
  }
  if (type === "loop.model.set") {
    const msg = value as { providerId?: unknown; slot?: unknown; model?: unknown };
    return (
      typeof msg.providerId === "string" &&
      msg.providerId.length > 0 &&
      msg.providerId.length <= 64 &&
      typeof msg.slot === "string" &&
      msg.slot.length > 0 &&
      msg.slot.length <= 64 &&
      // Model itself may be "" (clears the slot back to inherit).
      typeof msg.model === "string" &&
      msg.model.length <= SESSION_MAX_MODEL_CHARS
    );
  }
  if (type === "loop.models.read") {
    const msg = value as { providerId?: unknown };
    return typeof msg.providerId === "string" && msg.providerId.length > 0 && msg.providerId.length <= 64;
  }
  return false;
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SESSION_MAX_ID_CHARS
  );
}
