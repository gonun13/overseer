import type {
  AppliedPersonality,
  DiscoveredAdapter,
  DiscoveredProject,
  DiscoveryEvent,
  DiscoveryOutcome,
  FurnitureReveal,
  RejectedCustomization,
  UntrackedFolder,
} from "@overseer/protocol";
import { message } from "../lang";
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
 * Minimum length of the boot beat.
 *
 * The beat always runs at least this long so the designed opening is visible
 * on a healthy connection (the socket opens in ~10ms). Leaving boot also
 * requires the socket: connection wait belongs here — on the loading bar —
 * not in discovery, where the wizard should already be running. If `/ws` is
 * queued behind Firefox connection slots the bar sits full past this mark
 * with headline "connecting" until the socket opens.
 *
 * `LoadingBar` fills over exactly this long; it reads the value from here so
 * the animation and the minimum beat cannot drift apart.
 */
export const BOOT_MS = 3000;

export type WizardPhase =
  /** Boot beat + socket gate. Stays until BOOT_MS has elapsed *and* connected. */
  | "boot"
  /** Connected. First-run walks intro → name → tone → greet; returns skip to name/greet. */
  | "welcome"
  /** Discovery running; the operations window is up and steps are arriving. */
  | "discovery"
  /** Discovery complete; furniture mounting per resolved capability. */
  | "settling"
  /** Done. The wizard stops driving anything and normal derivation takes over. */
  | "ready";

/** Beats inside `welcome`. First turn: intro → name → tone → greet. A return
 * visit lands on `name` or `greet` depending on whether a name is already known. */
export type WelcomeBeat = "intro" | "name" | "tone" | "greet";

export type PersonalityTone = NonNullable<AppliedPersonality["tone"]>;

export const TONES: PersonalityTone[] = ["neutral", "dry", "warm"];

export interface WizardState {
  phase: WizardPhase;
  /** Only set while `phase === "welcome"`. */
  welcomeBeat?: WelcomeBeat;
  steps: OperationStep[];
  projects: DiscoveredProject[];
  /** Workspace folders that are not git projects — drive signals. */
  untrackedFolders: UntrackedFolder[];
  adapters: DiscoveredAdapter[];
  /** Adapter the operator connected. Undefined until they pick one (or a
   * prior attach is restored). Never defaults to the first registered id. */
  attachedAdapterId?: string;
  /** Undefined until discovery reports it — the frontend never assumes a path. */
  workspaceRoot?: string;
  /** Active project path from internal memory / discovery default. */
  activeProjectPath?: string;
  /** Furniture unlocked so far this pass. Permanent once true. */
  revealed: Record<FurnitureReveal, boolean>;
  /** Bumps when a worker appends an operations line — App summons the
   * overseer window for that run (docs/overseer.md §3). */
  operationTick: number;
  /** Undefined until known. `false` is a real answer; "not yet asked" is not. */
  returning?: boolean;
  personality: AppliedPersonality;
  rejected: RejectedCustomization[];
  /** Set when the socket or the pass itself failed. The wizard reports it
   * rather than hanging on a step that will never resolve. */
  error?: string;
  /** Whether the socket is open. Boot will not advance until this is true. */
  connected: boolean;
  /** Server wall clock (ISO). Furniture clock ticks from this, not the browser. */
  serverTime?: string;
  /** Whether the minimum boot beat has elapsed. Paired with `connected` to
   * leave boot — either can arrive first. */
  bootMinElapsed: boolean;
}

const NO_REVEAL: Record<FurnitureReveal, boolean> = {
  clock: false,
  projectPanel: false,
  activeProject: false,
  adapterWidget: false,
  footer: false,
  prompt: false,
};

export const INITIAL_WIZARD: WizardState = {
  phase: "boot",
  steps: [],
  projects: [],
  untrackedFolders: [],
  adapters: [],
  revealed: { ...NO_REVEAL },
  personality: {},
  rejected: [],
  connected: false,
  bootMinElapsed: false,
  operationTick: 0,
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
  /** Socket is up *and* the server sent identity for the welcome beat. */
  | {
      type: "socket.open";
      returning: boolean;
      personality: AppliedPersonality;
      serverTime: string;
    }
  | { type: "socket.error"; message: string }
  | { type: "discovery.requested" }
  | { type: "server.event"; event: DiscoveryEvent }
  /** The minimum boot beat has elapsed; leave boot only if also connected. */
  | { type: "boot.ready" }
  /** First-run intro held long enough — ask for the operator's name. */
  | { type: "intro.done" }
  /** First-run: the operator picked a tone. */
  | { type: "operator.toned"; tone: PersonalityTone }
  /** First-run welcome: the operator answered with a name. */
  | { type: "operator.named"; name: string }
  /** The welcome greet has been shown for long enough to read. */
  | { type: "welcome.done" }
  /** Operator picked a project in the panel — keep wizard state in sync. */
  | { type: "project.selected"; path: string }
  /** Operator connected an adapter from the picker. */
  | { type: "adapter.connected"; id: string }
  /** Live workspace scan — projects appeared or vanished under /workspace. */
  | {
      type: "workspace.projects";
      projects: DiscoveredProject[];
      untrackedFolders: UntrackedFolder[];
      activeProjectPath?: string;
    }
  /** Supervisor worker line for the operations window. */
  | {
      type: "overseer.step";
      id: string;
      label: string;
      outcome: DiscoveryOutcome;
      detail?: string;
    }
  /** Furniture has finished mounting; hand back to ordinary derivation. */
  | { type: "settled" };

/** Which welcome beat a freshly-connected session should land on. */
function initialWelcomeBeat(state: WizardState): WelcomeBeat {
  // First turn of this instance always opens with the intro.
  if (!state.returning) return "intro";
  if (!state.personality.name) return "name";
  // Tone is only "set" when the operator picked it (or wrote it into
  // personality) — absence means the picker still owes them a turn.
  if (!state.personality.tone) return "tone";
  return "greet";
}

/** Leave boot once both gates are true. Either can arrive first. */
function leaveBootIfReady(state: WizardState): WizardState {
  if (
    state.phase === "boot" &&
    state.bootMinElapsed &&
    state.connected &&
    state.error === undefined
  ) {
    return {
      ...state,
      phase: "welcome",
      welcomeBeat: initialWelcomeBeat(state),
    };
  }
  return state;
}

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "socket.open":
      return leaveBootIfReady({
        ...state,
        connected: true,
        returning: action.returning,
        personality: action.personality,
        serverTime: action.serverTime,
      });

    case "socket.error":
      return { ...state, error: action.message, connected: false, phase: "ready" };

    case "boot.ready":
      return leaveBootIfReady({ ...state, bootMinElapsed: true });

    case "intro.done":
      if (state.phase !== "welcome" || state.welcomeBeat !== "intro") return state;
      if (!state.personality.name) return { ...state, welcomeBeat: "name" };
      if (!state.personality.tone) return { ...state, welcomeBeat: "tone" };
      return { ...state, welcomeBeat: "greet" };

    case "operator.named": {
      if (state.phase !== "welcome") return state;
      const personality = { ...state.personality, name: action.name };
      // Server ack after an optimistic advance — update the name, don't rewind.
      if (state.welcomeBeat === "tone" || state.welcomeBeat === "greet") {
        return { ...state, personality };
      }
      return {
        ...state,
        personality,
        // Tone picker runs until a tone is actually on file, first turn or not.
        welcomeBeat: personality.tone ? "greet" : "tone",
      };
    }

    case "operator.toned":
      if (state.phase !== "welcome" || state.welcomeBeat !== "tone") return state;
      return {
        ...state,
        personality: { ...state.personality, tone: action.tone },
        welcomeBeat: "greet",
      };

    case "welcome.done":
      // Never leave welcome while still mid-intro/ask — the greet is the exit.
      if (state.phase !== "welcome" || state.welcomeBeat !== "greet") return state;
      if (!state.personality.name) return state;
      return { ...state, phase: "discovery", welcomeBeat: undefined };

    case "project.selected":
      return { ...state, activeProjectPath: action.path };

    case "adapter.connected":
      return { ...state, attachedAdapterId: action.id };

    case "workspace.projects": {
      const { projects, untrackedFolders } = action;
      const preferred =
        action.activeProjectPath ??
        (state.activeProjectPath !== undefined &&
        projects.some((p) => p.path === state.activeProjectPath)
          ? state.activeProjectPath
          : undefined);
      return {
        ...state,
        projects,
        untrackedFolders,
        activeProjectPath: preferred,
      };
    }

    case "overseer.step":
      return {
        ...state,
        operationTick: state.operationTick + 1,
        steps: [
          ...state.steps,
          {
            id: action.id,
            label: action.label,
            activity: OUTCOME_ACTIVITY[action.outcome],
            detail: action.detail,
          },
        ],
      };

    case "discovery.requested":
      return {
        ...state,
        phase: "discovery",
        steps: [],
        welcomeBeat: undefined,
        revealed: { ...NO_REVEAL },
      };

    case "settled":
      return state.phase === "settling" ? { ...state, phase: "ready" } : state;

    case "server.event":
      return applyEvent(state, action.event);
  }
}

function applyReveal(
  revealed: Record<FurnitureReveal, boolean>,
  keys: FurnitureReveal[] | undefined,
): Record<FurnitureReveal, boolean> {
  if (!keys || keys.length === 0) return revealed;
  const next = { ...revealed };
  for (const key of keys) next[key] = true;
  return next;
}

function applyEvent(state: WizardState, event: DiscoveryEvent): WizardState {
  switch (event.type) {
    case "discovery.start":
      return {
        ...state,
        phase: "discovery",
        steps: [],
        revealed: { ...NO_REVEAL },
      };

    case "discovery.step.start":
      return {
        ...state,
        steps: [
          ...state.steps,
          { id: event.id, label: event.label, activity: "working" },
        ],
      };

    case "discovery.step.done": {
      // Clock detail is formatted here in the browser's locale so it matches
      // the furniture clock; the server only supplies the ISO instant.
      const detail =
        event.serverTime !== undefined
          ? new Date(event.serverTime).toLocaleTimeString(undefined, {
              hour12: false,
            })
          : event.detail;
      return {
        ...state,
        steps: state.steps.map((step) =>
          step.id === event.id
            ? {
                ...step,
                activity: OUTCOME_ACTIVITY[event.outcome],
                detail,
              }
            : step,
        ),
        ...(event.projects !== undefined ? { projects: event.projects } : {}),
        ...(event.untrackedFolders !== undefined
          ? { untrackedFolders: event.untrackedFolders }
          : {}),
        ...(event.adapters !== undefined ? { adapters: event.adapters } : {}),
        ...(event.workspaceRoot !== undefined
          ? { workspaceRoot: event.workspaceRoot }
          : {}),
        ...(event.activeProjectPath !== undefined
          ? { activeProjectPath: event.activeProjectPath }
          : {}),
        ...(event.attachedAdapterId !== undefined
          ? { attachedAdapterId: event.attachedAdapterId }
          : {}),
        ...(event.serverTime !== undefined
          ? { serverTime: event.serverTime }
          : {}),
        ...(event.personality !== undefined
          ? { personality: event.personality }
          : {}),
        ...(event.rejected !== undefined ? { rejected: event.rejected } : {}),
        revealed: applyReveal(state.revealed, event.reveal),
      };
    }

    case "discovery.complete":
      return {
        ...state,
        phase: "settling",
        projects: event.projects,
        untrackedFolders: event.untrackedFolders ?? [],
        adapters: event.adapters,
        workspaceRoot: event.workspaceRoot,
        activeProjectPath: event.activeProjectPath,
        // Omitted means none attached — do not keep a stale id from a prior pass.
        attachedAdapterId: event.attachedAdapterId,
        returning: event.returning,
        personality: event.personality ?? state.personality,
        rejected: event.rejected ?? [],
        // Complete is the backstop: anything not yet revealed becomes known.
        revealed: {
          clock: true,
          projectPanel: true,
          activeProject: true,
          adapterWidget: true,
          footer: true,
          prompt: true,
        },
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
  activeProject: boolean;
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
  const { revealed } = state;
  return {
    clock: revealed.clock,
    projectPanel: revealed.projectPanel,
    activeProject: revealed.activeProject,
    adapterWidget: revealed.adapterWidget,
    footer: revealed.footer,
    // Prompt slot is released by the final discovery step; still needs an
    // attached signed-in adapter — otherwise the composer has nowhere to send.
    prompt:
      revealed.prompt &&
      state.adapters.some(
        (a) =>
          a.id === state.attachedAdapterId && a.status.authenticated,
      ),
    // Signals need an active project context to mean anything.
    signals: revealed.activeProject,
  };
}

/**
 * True while welcome is waiting for the operator to type a name. The ask is
 * rendered as an inline field in the headline, not as a typed string — see
 * OverseerSpace.
 */
export function welcomeNeedsName(state: WizardState): boolean {
  return state.phase === "welcome" && state.welcomeBeat === "name";
}

/** True while the first-run tone picker is up. */
export function welcomeNeedsTone(state: WizardState): boolean {
  return state.phase === "welcome" && state.welcomeBeat === "tone";
}

/**
 * The headline while the wizard is driving. Returns undefined once it is not —
 * from `settling` on, `headlineFor` owns the headline again, so the wizard can
 * never end up shadowing a real state word with a stale greeting.
 *
 * While `welcomeNeedsName` is true this returns undefined: the ask UI owns the
 * headline slot, and a string here would fight it. Copy comes from
 * `packages/web/src/lang` and varies with tone.
 */
export function wizardHeadline(state: WizardState): string | undefined {
  const tone = state.personality.tone;
  switch (state.phase) {
    case "boot":
      // Socket wait lives on the loading bar. Past the minimum beat, say so
      // rather than implying the designed opening is still running.
      return state.bootMinElapsed && !state.connected
        ? message(tone, "connecting")
        : message(tone, "starting");
    case "welcome": {
      switch (state.welcomeBeat) {
        case "intro":
        case "tone":
          // Self-introduction stays up through the tone pick — the buttons are
          // the question; the headline is still who is speaking.
          return message(tone, "intro");
        case "name":
          return undefined;
        case "greet": {
          if (state.personality.greeting) return state.personality.greeting;
          const name = state.personality.name!;
          return message(
            tone,
            state.returning ? "welcomeBack" : "welcome",
            { name },
          );
        }
        default:
          return undefined;
      }
    }
    // Boot already gated on the socket, so discovery always means a live pass.
    case "discovery":
      return message(tone, "lookingAround");
    default:
      return undefined;
  }
}

/** Name-ask prefix for the active tone (`welcome...` and variants). */
export function nameAskPrefix(state: WizardState): string {
  return message(state.personality.tone, "namePrefix");
}

/** True for the whole boot phase: minimum beat plus any wait for the socket. */
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
