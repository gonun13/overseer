import type {
  AppliedPersonality,
  DiscoveredProject,
  DiscoveryEvent,
  DiscoveryOutcome,
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

export type ClientMessage =
  /** Ask the server to run a discovery pass. Explicit rather than
   * connect-time-automatic: a reconnect must not silently re-run a scan the
   * operator did not ask for, and the client needs the operations window
   * mounted before steps start arriving. */
  | { type: "discovery.run" }
  /** First-run welcome: the operator's name, stored in overseer-personality.
   * The wizard asks before discovery so the greeting can use it. */
  | { type: "operator.name"; name: string }
  /** First-run intro: tone chosen after "I AM THE OVERSEER". */
  | { type: "operator.tone"; tone: PersonalityTone }
  /** Persist the operator's active project into internal memory. */
  | { type: "project.select"; path: string }
  /** Attach an adapter from the picker. Auth is a separate later step. */
  | { type: "adapter.connect"; id: string };

export interface ConnectedMessage {
  type: "connected";
  /** Server's clock at connect. The client renders time; the server owns it. */
  serverTime: string;
  /** True when this instance has a prior world snapshot — drives "welcome back". */
  returning: boolean;
  /** Accepted personality fields known before discovery (name/greeting for the
   * welcome beat). Absent fields mean unset, not "not yet asked". */
  personality?: AppliedPersonality;
}

export interface ErrorMessage {
  type: "error";
  /** Echoes the client message `type` that failed, when there was one. */
  about?: string;
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

/** Ack that an adapter was attached (not necessarily authenticated). */
export interface AdapterConnectedMessage {
  type: "adapter.connected";
  id: string;
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

export type ServerMessage =
  | ConnectedMessage
  | ErrorMessage
  | OperatorNamedMessage
  | OperatorTonedMessage
  | ProjectSelectedMessage
  | AdapterConnectedMessage
  | WorkspaceProjectsMessage
  | OverseerStepMessage
  | DiscoveryEvent;

const TONES = new Set<string>(["neutral", "dry", "warm"]);

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
  if (type === "adapter.connect") {
    return typeof (value as { id?: unknown }).id === "string";
  }
  return false;
}
