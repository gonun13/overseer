import type { AdapterUsageWindow } from "@overseer/protocol";
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
}

export interface Approval {
  id: string;
  activity: Activity;
  ref: string;
  sessionId: string;
  session: string;
  tool: string;
  body: string;
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
  spend: string;
  context: string;
}

export interface WorkspaceInfo {
  root: string;
  staging: string;
}

export type Turn =
  | { id: string; kind: "user" | "agent"; text: string }
  | { id: string; kind: "tool"; tool: string; target: string };

export type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

/** A console line. Kept for any non-xterm readouts; the live console window
 * streams through xterm rather than this shape. */
export type ConsoleLine = { kind: "in" | "out" | "err"; text: string };

export interface CapabilityDraft {
  name: string;
  kind: string;
  description: string;
  /** Free text for a skill or subagent; the thing actually being edited. */
  instructions: string;
  model: string;
  tools: { name: string; enabled: boolean }[];
  /** Where it lives on disk. The provider's layout, not the web layer's guess —
   * `.claude/skills/…` is true of claude-code and of nothing else in general. */
  file: string;
}
