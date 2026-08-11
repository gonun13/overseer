import type {
  AppliedPersonality,
  DiscoveredAdapter,
  DiscoveredProject,
  DiscoveryEvent,
  DiscoveryOutcome,
  RejectedCustomization,
} from "@overseer/protocol";
import type { Activity } from "../status";
import type { OperationStep, Project } from "../domain";

/**
 * The wizard's state machine. One place decides which furniture is mounted,
 * what the headline says and what the operations window shows — the alternative
 * is those three answers drifting apart in separate conditionals scattered
 * through App.tsx, which is how a "boots into headline-only state" rule quietly
 * stops being true.
 *
 * Everything here is derived from server events or the explicit absence of
 * them. Nothing is invented and nothing is a fixture: `data/mock.ts` is not
 * imported by this module or anything it pulls in (docs/overseer.md §4).
 */

/**
 * How long the boot beat runs.
 *
 * A designed duration, deliberately not tied to anything the network does.
 * Nothing is being fetched during it — the bundle has already run and React
 * has already mounted — so pinning it to the socket would let an event the
 * operator cannot see decide how long a piece of theatre lasts: invisible at
 * 10ms on a good connection, a minute on a bad one. The socket opens in
 * parallel and is waited for where it is genuinely needed, which is discovery.
 *
 * `LoadingBar` fills over exactly this long; it reads the value from here so
 * the animation and the phase cannot drift apart.
 */
export const BOOT_MS = 3000;

export type WizardPhase =
  /** The boot beat. Runs for BOOT_MS on its own clock, not the socket's. */
  | "boot"
  /** Connected, greeting the operator. */
  | "welcome"
  /** Discovery running; the operations window is up and steps are arriving. */
  | "discovery"
  /** Discovery complete; furniture mounting per resolved capability. */
  | "settling"
  /** Done. The wizard stops driving anything and normal derivation takes over. */
  | "ready";

export interface WizardState {
  phase: WizardPhase;
  steps: OperationStep[];
  projects: DiscoveredProject[];
  adapters: DiscoveredAdapter[];
  /** Undefined until discovery reports it — the frontend never assumes a path. */
  workspaceRoot?: string;
  /** Undefined until known. `false` is a real answer; "not yet asked" is not. */
  returning?: boolean;
  personality: AppliedPersonality;
  rejected: RejectedCustomization[];
  /** Set when the socket or the pass itself failed. The wizard reports it
   * rather than hanging on a step that will never resolve. */
  error?: string;
  /** Whether the socket is open. A fact about the connection, not a stage of
   * the boot: the presentation runs on its own clock and only discovery
   * actually waits on this. */
  connected: boolean;
}

export const INITIAL_WIZARD: WizardState = {
  phase: "boot",
  steps: [],
  projects: [],
  adapters: [],
  personality: {},
  rejected: [],
  connected: false,
};

/** Discovery outcomes are the same five activities in a different register —
 * no second vocabulary (docs/overseer.md §3). */
const OUTCOME_ACTIVITY: Record<DiscoveryOutcome, Activity> = {
  ok: "done",
  blocked: "waiting",
  failed: "attention",
  skipped: "idle",
};

export type WizardAction =
  | { type: "socket.open" }
  | { type: "socket.error"; message: string }
  | { type: "discovery.requested" }
  | { type: "server.event"; event: DiscoveryEvent }
  /** The boot beat has run its designed length. */
  | { type: "boot.done" }
  /** The welcome beat has been shown for long enough to read. */
  | { type: "welcome.done" }
  /** Furniture has finished mounting; hand back to ordinary derivation. */
  | { type: "settled" };

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "socket.open":
      // Records a fact and moves no phase.
      return { ...state, connected: true };

    case "socket.error":
      return { ...state, error: action.message, connected: false, phase: "ready" };

    case "boot.done":
      return state.phase === "boot" ? { ...state, phase: "welcome" } : state;

    case "welcome.done":
      return state.phase === "welcome" ? { ...state, phase: "discovery" } : state;

    case "discovery.requested":
      return { ...state, phase: "discovery", steps: [] };

    case "settled":
      return state.phase === "settling" ? { ...state, phase: "ready" } : state;

    case "server.event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: WizardState, event: DiscoveryEvent): WizardState {
  switch (event.type) {
    case "discovery.start":
      return { ...state, phase: "discovery", steps: [] };

    case "discovery.step.start":
      return {
        ...state,
        steps: [
          ...state.steps,
          { id: event.id, label: event.label, activity: "working" },
        ],
      };

    case "discovery.step.done":
      return {
        ...state,
        steps: state.steps.map((step) =>
          step.id === event.id
            ? {
                ...step,
                activity: OUTCOME_ACTIVITY[event.outcome],
                detail: event.detail,
              }
            : step,
        ),
      };

    case "discovery.complete":
      return {
        ...state,
        phase: "settling",
        projects: event.projects,
        adapters: event.adapters,
        workspaceRoot: event.workspaceRoot,
        returning: event.returning,
        personality: event.personality ?? {},
        rejected: event.rejected ?? [],
      };
  }
}

/**
 * Which furniture is mounted. A piece appears when the capability it reports on
 * becomes *knowable*, not when it becomes *good*: an adapter widget reading
 * "none attached" is the honest answer and hiding it leaves the operator with
 * nowhere to look.
 *
 * The prompt is the one exception, and it is a different kind of thing — a
 * control, not a readout. An input that cannot submit anywhere is not a
 * degraded readout, it is a broken control (docs/overseer.md §4).
 */
export interface Furniture {
  projectPanel: boolean;
  adapterWidget: boolean;
  clock: boolean;
  footer: boolean;
  prompt: boolean;
  /** Whether the ranked signal list may render at all. Signals describe a world
   * discovery has not looked at yet, so before it resolves they would state
   * "no project selected" as a finding rather than as the absence of one. */
  signals: boolean;
}

export function furnitureFor(state: WizardState): Furniture {
  const discovered = state.phase === "settling" || state.phase === "ready";
  return {
    projectPanel: discovered,
    adapterWidget: discovered,
    // The clock and the footer are furniture like the rest: they belong to the
    // settled screen, not to the boot one, and appear the moment its other
    // pieces do.
    clock: discovered,
    footer: discovered,
    prompt:
      discovered && state.adapters.some((a) => a.status.authenticated),
    signals: discovered,
  };
}

/**
 * The headline while the wizard is driving. Returns undefined once it is not —
 * from `settling` on, `headlineFor` owns the headline again, so the wizard can
 * never end up shadowing a real state word with a stale greeting.
 */
export function wizardHeadline(state: WizardState): string | undefined {
  switch (state.phase) {
    // Both beats run on their own clock and say only what they are. The socket
    // is opening underneath them, and if it is having trouble that is not this
    // beat's news to break — nothing here was waiting on it.
    case "boot":
      return "starting";
    case "welcome": {
      if (state.personality.greeting) return state.personality.greeting;
      const name = state.personality.name;
      const base = state.returning ? "welcome back" : "welcome";
      return name ? `${base}, ${name}` : base;
    }
    // The first phase that genuinely needs the connection, so the first one
    // with standing to report it missing.
    case "discovery":
      return state.connected ? "looking around" : "connecting";
    default:
      return undefined;
  }
}

/** True while the loading bar should run: the socket is not up yet and there is
 * genuinely nothing to show. */
export function isLoading(state: WizardState): boolean {
  return state.phase === "boot" && state.error === undefined;
}

/**
 * Discovered projects, in the shape the panel renders. Activity is `idle` for
 * every one of them and that is not a placeholder: sessions are what make a
 * project active, and this build has no session supervisor, so anything else
 * would be invented. `branch`/`dirty` stay undefined when git could not answer.
 */
export function projectsFor(state: WizardState): Project[] {
  return state.projects.map((project) => ({
    id: project.path,
    name: project.name,
    path: project.path,
    branch: project.gitBranch,
    dirty: project.dirty,
    activity: "idle" as Activity,
  }));
}
