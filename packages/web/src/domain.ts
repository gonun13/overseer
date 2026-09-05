import type { AdapterUsageWindow, PlanStatus } from "@overseer/protocol";
import type { Activity } from "./status";

/**
 * The shapes the UI renders. Types only — no data. Everything that renders
 * live server state imports from here so the overseer path stays provably
 * free of canned data.
 */

export interface Project {
  id: string;
  name: string;
  path: string;
  /** Undefined when git could not be read — never collapsed to a guess. */
  branch?: string;
  dirty?: boolean;
  activity: Activity;
  /** Why the light is lit — shown next to the project in the selector. */
  note?: string;
}

/** One line in the operations window. The overseer's own multi-step work —
 * discovery today, any automation later (docs/overseer.md §3). */
export interface OperationStep {
  id: string;
  /** Lowercase, present participle: it names the step while it runs. */
  label: string;
  activity: Activity;
  /** One short clause of context, shown under the line when present. */
  detail?: string;
}

export interface Session {
  id: string;
  activity: Activity;
  name: string;
  projectId: string;
  branch: string;
  model: string;
  cost: string;
  /** One line on what it is doing right now, for the overseer space. */
  doing: string;
  /** Set when this is a dev-loop run. Such a session lives in a console PTY,
   * not a chat window, and must never be resumed. */
  origin?: "loop";
  /** Workspace the loop run belongs to. Only set with `origin: "loop"`. */
  loopWorkspace?: string;
}

/** One plan in the plans window. `status` is the protocol's word for it,
 * rendered as-is: the operator reads the same vocabulary the server reasons
 * in. */
export interface Plan {
  id: string;
  activity: Activity;
  title: string;
  sessionId: string;
  /** Session name, when the session is still listed. */
  session?: string;
  status: PlanStatus;
  /** Short human-facing time, e.g. "3h ago". */
  when: string;
  /** False once the session that built it has been deleted — implementing it
   * starts a fresh session instead of resuming. */
  sessionExists: boolean;
}

export interface Capability {
  id: string;
  activity: Activity;
  name: string;
  kind: string;
  tools: number;
  /** Set when the capability needs the operator before it can be used. */
  problem?: string;
}

/** What the provider widget reads out. Empty strings mean "not been told yet",
 * never a stand-in value. */
export interface ProviderInfo {
  name: string;
  version: string;
  authenticated: boolean;
  /** False when the provider runtime could not be reached. */
  reachable?: boolean;
  /** Operator-facing status clause from the adapter, when it gave one. */
  detail?: string;
  /** True when this instance was signed in on an earlier run and now is not —
   * an expired or revoked credential, not a login never started. */
  authExpired?: boolean;
  /** Subscription windows. Empty means "not been told yet", never a stand-in. */
  usage: AdapterUsageWindow[];
  /** How the usage read went when signed in. */
  usageState?: "pending" | "ready" | "unavailable";
  /** Mirrors `AdapterCapabilities.usageCheck`: this provider has no automatic
   * gauges, but can be asked for a report on demand. Drives the widget's
   * CHECK USAGE button, and suppresses the "not available" line that would
   * otherwise describe the missing automatic path. */
  usageCheck: boolean;
  spend: string;
  context: string;
}

export interface WorkspaceInfo {
  root: string;
  staging: string;
}

export type Turn =
  | { id: string; kind: "user"; text: string }
  | {
      id: string;
      kind: "agent";
      text: string;
      /** The resolved model that produced this reply. Live turns only — a
       * runtime `set_model` can change what later turns in the same session
       * run on, so this is read off the turn itself, not the session's
       * current setting. Backfilled history leaves this unset. */
      model?: string;
    }
  | {
      id: string;
      kind: "thinking";
      /** The model's own reasoning for the reply that follows. Live turns
       * only — Claude can summarize or withhold this entirely depending on
       * account/model settings, so a turn is only ever created once real text
       * has arrived (see `applySessionEvent`); an empty stream leaves no turn
       * at all rather than a bubble with nothing in it. */
      text: string;
    }
  | {
      id: string;
      kind: "tool";
      tool: string;
      target: string;
      /** Live tool calls only — backfilled history leaves this unset. */
      status?: "running" | "ok" | "error";
    }
  | {
      /** The provider's `can_use_tool` request id. No `toolUseId` correlates
       * this back to the "tool" turn it follows — the CLI's permission
       * control request carries no such id — so it renders as its own turn. */
      id: string;
      kind: "approval";
      tool: string;
      /** Same reading as a tool row's: what the call is acting on. The tool
       * input itself is not shown — the operator is deciding whether this
       * tool may touch this target, not reviewing a payload. */
      target: string;
      /** Set only when the request came from a question tool. Then the
       * request is not an approval at all: the provider is asking the
       * operator something and the answers are what it gets back, so the row
       * shows the questions instead of allow/deny. */
      questions?: ApprovalQuestion[];
    };

/** One question a provider asked through its question tool, as the operator
 * sees it. `multiSelect` questions take any number of options; the rest take
 * exactly one. */
export type ApprovalQuestion = {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
};

export type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

/** A console line. Kept for any non-xterm readouts; the live console window
 * streams through xterm rather than this shape. */
export type ConsoleLine = { kind: "in" | "out" | "err"; text: string };

