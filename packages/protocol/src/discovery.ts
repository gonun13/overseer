import type { AdapterStatus } from "./adapter.js";

/**
 * Discovery: what the overseer learns about the world before any session
 * exists. Deliberately its own union rather than a member of `AgentEvent` —
 * every `AgentEvent` variant carries a `sessionId`, and discovery runs when
 * there is no session to carry.
 */

/**
 * How a step ended. Not a boolean: "checked the adapter, it is not signed in"
 * is a step that ran correctly and found bad news, which is a different thing
 * from a step that threw — and the operator acts on them differently. Maps
 * one-to-one onto the `Activity` vocabulary the UI already has, so a step needs
 * no colour or icon of its own (docs/overseer.md §3).
 */
export type DiscoveryOutcome =
  /** Ran, found what it was looking for. → `done` / [OK] */
  | "ok"
  /** Ran, and what it found needs the operator. → `waiting` / [BLOCKED] */
  | "blocked"
  /** Could not run. → `attention` / [FAILED] */
  | "failed"
  /** Did not apply this time. → `idle` / [SKIPPED] */
  | "skipped";

export interface DiscoveredProject {
  path: string;
  name: string;
  gitBranch?: string;
  /** Undefined means not determined — never collapse that to `false`. */
  dirty?: boolean;
}

/** A workspace directory that is not a git project. Surfaced as a signal so
 * the operator knows why it is missing from the project list. */
export interface UntrackedFolder {
  path: string;
  name: string;
}

export interface DiscoveredAdapter {
  id: string;
  status: AdapterStatus;
  /**
   * True when this adapter was signed in on a previous run and now is not.
   *
   * A credential that stopped working is a different event from one that was
   * never obtained, and the more urgent of the two: nothing the operator did
   * caused it, and everything downstream of it will start failing. It gets its
   * own signal rather than being folded into "not authenticated".
   *
   * Cleared by a successful login, and by a deliberate sign-out — an operator
   * who signed out on purpose has not suffered an expiry.
   */
  authExpired?: true;
}

/** A customization the overseer refused to apply, and why. Surfaced to the
 * operator as a signal — a silently dropped customization is worse than a
 * refused one (docs/overseer.md §6.4). */
export interface RejectedCustomization {
  field: string;
  reason: string;
}

/** Furniture a discovery step can unlock. Permanent once revealed
 * (docs/overseer.md §4). */
export type FurnitureReveal =
  | "clock"
  | "projectPanel"
  | "activeProject"
  | "adapterWidget"
  | "footer"
  | "prompt";

/** Optional world update that rides with a finished step so furniture and
 * data arrive in the same paced beat as the operations line. */
export interface DiscoveryStepUpdate {
  projects?: DiscoveredProject[];
  /** Direct children of the workspace that are not git projects. */
  untrackedFolders?: UntrackedFolder[];
  activeProjectPath?: string;
  attachedAdapterId?: string;
  adapters?: DiscoveredAdapter[];
  workspaceRoot?: string;
  /** Server wall clock (ISO). Refreshes the furniture clock so it matches the
   * "checking the time" step rather than the browser's local zone. */
  serverTime?: string;
  personality?: AppliedPersonality;
  rejected?: RejectedCustomization[];
  /** True when this pass had to recreate `overseer-personality` after finding
   * it gone on a returning instance. */
  personalityRescued?: true;
  reveal?: FurnitureReveal[];
}

export type DiscoveryEvent =
  | { type: "discovery.start"; runId: string }
  | { type: "discovery.step.start"; runId: string; id: string; label: string }
  | ({
      type: "discovery.step.done";
      runId: string;
      id: string;
      outcome: DiscoveryOutcome;
      detail?: string;
    } & DiscoveryStepUpdate)
  | {
      type: "discovery.complete";
      runId: string;
      projects: DiscoveredProject[];
      untrackedFolders?: UntrackedFolder[];
      adapters: DiscoveredAdapter[];
      /** Where the scan ran. A deployment fact the frontend must be told. */
      workspaceRoot: string;
      /** True when this instance has run before — drives the wizard's
       * "welcome back" branch instead of replaying first-run. */
      returning: boolean;
      /** Last active project path, resolved this pass (memory or default). */
      activeProjectPath: string;
      /** Adapter the operator previously connected, if still registered.
       * Omitted when none is attached — never defaults to a registered id. */
      attachedAdapterId?: string;
      /** Accepted personality customization, already filtered through the
       * internal allowlist. Never the raw file contents. */
      personality?: AppliedPersonality;
      /** Non-empty when the operator wrote something that was refused. */
      rejected?: RejectedCustomization[];
      /** True when this pass recreated `overseer-personality` after deletion. */
      personalityRescued?: true;
    };

/** The customizable surface, post-validation. Everything outside this shape was
 * either rejected or never offered (docs/overseer.md §6.4). */
export interface AppliedPersonality {
  tone?: "neutral" | "dry" | "warm";
  name?: string;
  typingChance?: number;
  greeting?: string;
}
