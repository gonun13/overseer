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

export type WizardPhase =
  /** Socket connecting. Nothing is known — not even whether this is a first run. */
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
  /** How many times the socket has been dialled again after failing to open.
   * Shown, not hidden: a boot that is quietly on its third attempt looks
   * identical to one that is simply slow, and they are not the same thing. */
  attempt: number;
  /** The socket has taken long enough that saying nothing would be a lie of
   * omission. The connection is local; past a second or two it is not slow,
   * it is stuck. */
  slow: boolean;
}

export const INITIAL_WIZARD: WizardState = {
  phase: "boot",
  steps: [],
  projects: [],
  adapters: [],
  personality: {},
  rejected: [],
  attempt: 0,
  slow: false,
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
  /** The socket is still not open and the wait has become worth naming. */
  | { type: "socket.slow" }
  /** The socket never opened; it has been dropped and dialled again. */
  | { type: "socket.retry" }
  | { type: "discovery.requested" }
  | { type: "server.event"; event: DiscoveryEvent }
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
      // Clears `slow` on the way through: a connection that took three tries
      // still opened, and the headline should stop apologising once it has.
      return state.phase === "boot"
        ? { ...state, phase: "welcome", slow: false }
        : state;

    case "socket.error":
      return { ...state, error: action.message, phase: "ready" };

    case "socket.slow":
      return state.phase === "boot" ? { ...state, slow: true } : state;

    case "socket.retry":
      // Stays in `boot` — nothing has been learned, so nothing downstream may
      // proceed. Only the attempt count moves.
      return state.phase === "boot"
        ? { ...state, attempt: state.attempt + 1, slow: true }
        : state;

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
    case "boot":
      // A boot that is retrying says so. Staring at "starting" for forty
      // seconds tells the operator nothing about whether anything is wrong,
      // and the honest answer is cheap to give.
      if (state.attempt > 0) return "reconnecting";
      return state.slow ? "still starting" : "starting";
    case "welcome": {
      if (state.personality.greeting) return state.personality.greeting;
      const name = state.personality.name;
      const base = state.returning ? "welcome back" : "welcome";
      return name ? `${base}, ${name}` : base;
    }
    case "discovery":
      return "looking around";
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
