import type { Activity } from "./status";

/**
 * The shapes the UI renders. Types only — no data, and in particular no
 * fixtures: `data/mock.ts` imports from here to describe its wireframe rows,
 * and so does everything that renders live server state.
 *
 * Split out of `data/mock.ts` because importing a type from the fixture module
 * meant every consumer of a shape also imported the fixtures' module graph. The
 * overseer's own path has to be provably free of canned data (#8), and "free of
 * it except for the types" is not a claim a grep can check.
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

/** What the adapter widget reads out. Empty strings mean "not been told yet",
 * never a stand-in value. */
export interface AdapterInfo {
  name: string;
  version: string;
  authenticated: boolean;
  /** Fraction of the plan's window consumed. */
  usage: number;
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

/** A console line. `in` is what the operator sent to the CLI, `out` is what it
 * printed back, `err` is stderr — the three states a terminal has. */
export type ConsoleLine = { kind: "in" | "out" | "err"; text: string };

export interface CapabilityDraft {
  name: string;
  kind: string;
  description: string;
  /** Free text for a skill or subagent; the thing actually being edited. */
  instructions: string;
  model: string;
  tools: { name: string; enabled: boolean }[];
  /** Where it lives on disk. The adapter's layout, not the web layer's guess —
   * `.claude/skills/…` is true of claude-code and of nothing else in general. */
  file: string;
}
