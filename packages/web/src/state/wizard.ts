import type {
  AdapterStatus,
  AppliedPersonality,
  AuthStateMessage,
  DiscoveredProject,
  DiscoveredProvider,
  DiscoveryEvent,
  DiscoveryOutcome,
  FurnitureReveal,
  OverseerTheme,
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
  /** Connected. First-run walks name → tone → greet; returns skip to the
   * first missing beat. "I AM THE OVERSEER" is the tone-pick headline, not a
   * beat of its own. */
  | "welcome"
  /** Discovery running; the operations window is up and steps are arriving. */
  | "discovery"
  /** Discovery complete; furniture mounting per resolved capability. */
  | "settling"
  /** Done. The wizard stops driving anything and normal derivation takes over. */
  | "ready";

/** Beats inside `welcome`. Name → tone → greet. A return visit lands on
 * whichever of those is still owed. */
export type WelcomeBeat = "intro" | "name" | "tone" | "greet";

export type PersonalityTone = NonNullable<AppliedPersonality["tone"]>;

export const TONES: PersonalityTone[] = ["neutral", "dry", "warm"];

/**
 * Where the reset flow has got to. Deliberately a field of its own rather than
 * a `WizardPhase`: a reset can be asked for at any point after the clock
 * appears, and folding it into the phase would throw away whichever phase was
 * running — a decline would then have to invent one to go back to.
 */
export type ResetStage =
  /** The decision is up. Nothing has been erased and nothing has been sent. */
  | "confirm"
  /** The operator said no. Held for a beat so the answer can be read. */
  | "declined"
  /** The wipe is running: steps arrive, furniture leaves. */
  | "working"
  /** Everything is gone. One last headline, then the reload. */
  | "goodbye";

/**
 * The order furniture is taken away in during a wipe, one piece per delete
 * step. Controls first and the clock last: the operator loses the ability to
 * start new work before they lose the ability to read what is happening, which
 * is the same order the wizard mounts them in, reversed.
 */
const TEARDOWN_ORDER: FurnitureReveal[] = [
  "prompt",
  "footer",
  "providerWidget",
  "activeProject",
  "projectPanel",
  "clock",
];

/**
 * The login flow as the console holds it. A straight copy of the server's
 * `auth.state` frame minus the envelope: the server owns this machine (it is
 * the thing holding the child process), and a second client-side model of it
 * would only be able to disagree.
 */
export interface AuthFlow {
  providerId: string;
  phase: AuthStateMessage["phase"];
  verificationUrl?: string;
  detail?: string;
  retryable?: boolean;
  status?: AdapterStatus;
}

export interface WizardState {
  phase: WizardPhase;
  /** Only set while `phase === "welcome"`. */
  welcomeBeat?: WelcomeBeat;
  steps: OperationStep[];
  projects: DiscoveredProject[];
  /** Workspace folders that are not git projects — drive signals. */
  untrackedFolders: UntrackedFolder[];
  providers: DiscoveredProvider[];
  /** Provider the operator connected. Undefined until they pick one (or a
   * prior attach is restored). Never defaults to the first registered id. */
  attachedProviderId?: string;
  /** The login flow, when one has been started or joined. Undefined means no
   * login has happened this session — not that the provider is signed out. */
  auth?: AuthFlow;
  /** Undefined until discovery reports it — the frontend never assumes a path. */
  workspaceRoot?: string;
  /** Active project path from internal memory / discovery default. */
  activeProjectPath?: string;
  /** Theme from internal memory. Samaritan until the server says otherwise. */
  theme: OverseerTheme;
  /** Furniture unlocked so far this pass. Permanent once true. */
  revealed: Record<FurnitureReveal, boolean>;
  /** Bumps when a worker appends an operations line — App summons the
   * overseer window for that run (docs/overseer.md §3). */
  operationTick: number;
  /** Undefined until known. `false` is a real answer; "not yet asked" is not. */
  returning?: boolean;
  personality: AppliedPersonality;
  rejected: RejectedCustomization[];
  /** True while `overseer-personality` is missing on disk and the operator
   * must restart for discovery to restore defaults. */
  personalityMissing: boolean;
  /** True after a returning discovery recreated it from defaults. */
  personalityRescued: boolean;
  /** One of the alarm headline words, picked once when the complaint lands
   * so re-renders do not shuffle `DANGER` → `WHY???`. */
  personalityRescueHeadline?: string;
  /** How far the reset flow has got. Undefined when none has been asked for. */
  reset?: ResetStage;
  /** Force the next headline change to type out. Set when a refused reset
   * hands the headline back to derivation — otherwise `blocked` (and the
   * rest of the activity words) land as an instant swap and the reset's
   * typing register breaks. */
  forceHeadlineType: boolean;
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
  providerWidget: false,
  footer: false,
  prompt: false,
};

export const INITIAL_WIZARD: WizardState = {
  phase: "boot",
  steps: [],
  projects: [],
  untrackedFolders: [],
  providers: [],
  theme: "samaritan",
  revealed: { ...NO_REVEAL },
  personality: {},
  rejected: [],
  personalityMissing: false,
  personalityRescued: false,
  forceHeadlineType: false,
  connected: false,
  bootMinElapsed: false,
  operationTick: 0,
};

/**
 * Headline words when `overseer-personality` is gone or had to be restored.
 * Deliberately not the activity vocabulary — deleting the brain is not merely
 * `blocked`. CSS uppercases them; `why???` keeps its punctuation.
 */
export const PERSONALITY_RESCUE_HEADLINES = [
  "danger",
  "braindead",
  "why???",
] as const;

export function pickPersonalityRescueHeadline(
  random: () => number = Math.random,
): string {
  const i = Math.floor(random() * PERSONALITY_RESCUE_HEADLINES.length);
  return PERSONALITY_RESCUE_HEADLINES[i] ?? PERSONALITY_RESCUE_HEADLINES[0];
}

/** First time the complaint lands, pick a headline and keep it stable. */
function personalityAlarmHeadline(
  state: WizardState,
): Pick<WizardState, "personalityRescueHeadline"> {
  return {
    personalityRescueHeadline:
      state.personalityRescueHeadline ?? pickPersonalityRescueHeadline(),
  };
}

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
      theme?: OverseerTheme;
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
  /** Operator picked a theme — keep wizard state in sync. */
  | { type: "theme.selected"; theme: OverseerTheme }
  /** Operator connected a provider from the picker. */
  | { type: "provider.connected"; id: string }
  /** Whole login state from the server, in one frame. */
  | { type: "auth.state"; state: AuthFlow }
  /** The operator asked to start a login — shows the surface as `starting`
   * before the server's first frame, so the click is never a dead beat. */
  | { type: "auth.requested"; providerId: string }
  /** Live workspace scan — projects appeared or vanished under /workspace. */
  | {
      type: "workspace.projects";
      projects: DiscoveredProject[];
      untrackedFolders: UntrackedFolder[];
      activeProjectPath?: string;
      personality?: AppliedPersonality;
      rejected?: RejectedCustomization[];
      personalityMissing?: true;
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
  | { type: "settled" }
  /** The operator asked to reset; the decision goes up. Nothing is sent yet. */
  | { type: "reset.asked" }
  /** The operator answered no. */
  | { type: "reset.declined" }
  /** The declined beat has been read; back to ordinary derivation. */
  | { type: "reset.dismissed" }
  /** A forced type-out finished; stop forcing. */
  | { type: "headline.typed" }
  /** The operator answered yes. `memory.reset` is on the wire. */
  | { type: "reset.confirmed" }
  /** The server finished erasing. Only the goodbye is left. */
  | { type: "reset.done" };

/** Which welcome beat a freshly-connected session should land on. */
function initialWelcomeBeat(state: WizardState): WelcomeBeat {
  // Name first. The self-introduction is the headline *behind* the tone
  // buttons — showing it alone before the ask made "I AM THE OVERSEER" land
  // twice on a first run (once here, once on tone).
  if (!state.personality.name) return "name";
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
        ...(action.theme !== undefined ? { theme: action.theme } : {}),
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
      // Name and tone are both owed before discovery may run.
      if (state.phase !== "welcome" || state.welcomeBeat !== "greet") return state;
      if (!state.personality.name || !state.personality.tone) return state;
      return { ...state, phase: "discovery", welcomeBeat: undefined };

    case "project.selected":
      return { ...state, activeProjectPath: action.path };

    case "theme.selected":
      return { ...state, theme: action.theme };

    case "provider.connected":
      return { ...state, attachedProviderId: action.id };

    case "auth.requested":
      return {
        ...state,
        auth: { providerId: action.providerId, phase: "starting" },
      };

    case "auth.state": {
      const { state: auth } = action;
      // A settled flow carries the re-checked status. Fold it into the provider
      // list so the prompt gate, the widget and the signals all follow from
      // the same fact — otherwise the login says "success" while everything
      // around it still reads the status discovery saw at boot, and only a
      // page reload would agree.
      const providers =
        auth.status === undefined
          ? state.providers
          : state.providers.map((provider) => {
              if (provider.id !== auth.providerId) return provider;
              const { authExpired: _cleared, ...rest } = provider;
              return auth.status!.authenticated
                ? { ...rest, status: auth.status! }
                : { ...provider, status: auth.status! };
            });
      return { ...state, auth, providers };
    }

    case "workspace.projects": {
      // The wipe deletes `personality.json`, so the monitor is about to report
      // it missing and ask for a restart. That complaint describes an accident;
      // this is the operator erasing it on purpose, and the reload is already
      // coming.
      if (state.reset === "working" || state.reset === "goodbye") return state;
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
        ...(action.personality !== undefined
          ? { personality: action.personality }
          : {}),
        ...(action.rejected !== undefined ? { rejected: action.rejected } : {}),
        ...(action.personalityMissing
          ? {
              personalityMissing: true,
              ...personalityAlarmHeadline(state),
            }
          : action.personality !== undefined
            ? { personalityMissing: false }
            : {}),
      };
    }

    case "overseer.step":
      // Name / tone / intro / greet own the screen. Worker lines must not fill
      // the operations list (or summon the window) until setup has handed off.
      if (state.phase === "boot" || state.phase === "welcome") return state;
      return {
        ...state,
        operationTick: state.operationTick + 1,
        // Each line of the wipe costs the operator a piece of the instrument,
        // so the report and the field say the same thing at the same time.
        ...(state.reset === "working"
          ? { revealed: withoutNextFurniture(state) }
          : {}),
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

    case "reset.asked":
      // Asking again mid-wipe would put the decision back over a teardown that
      // cannot be stopped. Only an untouched instance — or one that just said
      // no — can be asked.
      if (state.reset !== undefined && state.reset !== "declined") return state;
      return { ...state, reset: "confirm" };

    case "reset.declined":
      return state.reset === "confirm" ? { ...state, reset: "declined" } : state;

    case "reset.dismissed":
      return state.reset === "declined"
        ? { ...state, reset: undefined, forceHeadlineType: true }
        : state;

    case "headline.typed":
      return state.forceHeadlineType
        ? { ...state, forceHeadlineType: false }
        : state;

    case "reset.confirmed":
      if (state.reset !== "confirm") return state;
      return {
        ...state,
        reset: "working",
        // The teardown is its own report; whatever the last operation left in
        // the window is not part of it.
        steps: [],
        // Summons the operations window before the first delete step lands, so
        // the wipe is watched rather than discovered halfway through.
        operationTick: state.operationTick + 1,
      };

    case "reset.done":
      if (state.reset !== "working") return state;
      // Whatever furniture outlasted the delete steps goes with the last one.
      return { ...state, reset: "goodbye", revealed: { ...NO_REVEAL } };

    case "server.event":
      return applyEvent(state, action.event);
  }
}

/**
 * Take away the first piece still standing, in teardown order.
 *
 * What is *revealed* and what is *mounted* are not the same thing — the prompt
 * slot can be released with no authenticated provider to submit through — and a
 * step that unrevealed something the operator could not see would read as a
 * delete that cost nothing. Whatever is left when the steps run out goes with
 * `reset.done`.
 */
function withoutNextFurniture(
  state: WizardState,
): Record<FurnitureReveal, boolean> {
  const mounted = furnitureFor(state);
  const next = TEARDOWN_ORDER.find(
    (key) => state.revealed[key] && mounted[key],
  );
  if (next === undefined) return state.revealed;
  return { ...state.revealed, [next]: false };
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
  // Discovery must not start — or stream steps — until welcome has finished.
  // A stray frame would open the operations window over the name/tone ask.
  if (
    (state.phase === "boot" || state.phase === "welcome") &&
    event.type.startsWith("discovery.")
  ) {
    return state;
  }

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
        ...(event.providers !== undefined
          ? { providers: event.providers }
          : {}),
        ...(event.workspaceRoot !== undefined
          ? { workspaceRoot: event.workspaceRoot }
          : {}),
        ...(event.activeProjectPath !== undefined
          ? { activeProjectPath: event.activeProjectPath }
          : {}),
        ...(event.attachedProviderId !== undefined
          ? { attachedProviderId: event.attachedProviderId }
          : {}),
        ...(event.serverTime !== undefined
          ? { serverTime: event.serverTime }
          : {}),
        ...(event.personality !== undefined
          ? { personality: event.personality }
          : {}),
        ...(event.rejected !== undefined ? { rejected: event.rejected } : {}),
        ...(event.personalityRescued
          ? {
              personalityRescued: true,
              personalityMissing: false,
              ...personalityAlarmHeadline(state),
            }
          : {}),
        revealed: applyReveal(state.revealed, event.reveal),
      };
    }

    case "discovery.complete":
      return {
        ...state,
        phase: "settling",
        projects: event.projects,
        untrackedFolders: event.untrackedFolders ?? [],
        providers: event.providers,
        workspaceRoot: event.workspaceRoot,
        activeProjectPath: event.activeProjectPath,
        // Omitted means none attached — do not keep a stale id from a prior pass.
        attachedProviderId: event.attachedProviderId,
        returning: event.returning,
        personality: event.personality ?? state.personality,
        rejected: event.rejected ?? [],
        // Restart path: discovery restored defaults. Clear the live "missing"
        // ask; keep or set the rescued confirmation.
        personalityMissing: false,
        ...(event.personalityRescued
          ? {
              personalityRescued: true,
              ...personalityAlarmHeadline(state),
            }
          : {
              personalityRescued: false,
              personalityRescueHeadline: undefined,
            }),
        // Complete is the backstop: anything not yet revealed becomes known.
        revealed: {
          clock: true,
          projectPanel: true,
          activeProject: true,
          providerWidget: true,
          footer: true,
          prompt: true,
        },
      };
  }
}

/**
 * Which furniture is mounted. A piece appears when the capability it reports on
 * becomes *knowable*, not when it becomes *good*: a provider widget reading
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
  providerWidget: boolean;
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
    providerWidget: revealed.providerWidget,
    footer: revealed.footer,
    // Prompt slot is released by the final discovery step; still needs an
    // attached signed-in provider — otherwise the composer has nowhere to send.
    prompt:
      revealed.prompt &&
      state.providers.some(
        (p) =>
          p.id === state.attachedProviderId && p.status.authenticated,
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
 *
 * A reset outranks the phase entirely. The decision window states the facts;
 * the headline is the overseer reacting to being asked, which is the one thing
 * only it can say (docs/overseer-behavior.md §2.3).
 */
export function wizardHeadline(state: WizardState): string | undefined {
  const tone = state.personality.tone;
  switch (state.reset) {
    case "confirm":
      return message(tone, "resetAsk");
    case "declined":
      return message(tone, "resetDeclined");
    case "working":
      return message(tone, "resetWorking");
    case "goodbye":
      return message(tone, "resetGoodbye");
  }
  switch (state.phase) {
    case "boot":
      // Socket wait lives on the loading bar. Past the minimum beat, say so
      // rather than implying the designed opening is still running.
      return state.bootMinElapsed && !state.connected
        ? message(tone, "connecting")
        : message(tone, "starting");
    case "welcome": {
      switch (state.welcomeBeat) {
        case "tone":
          // Self-introduction stays up through the tone pick — the buttons are
          // the question; the headline is still who is speaking.
          return message(tone, "intro");
        case "intro":
          // Kept so an old hold cannot strand the reducer; new sessions never
          // land here (initialWelcomeBeat skips straight to name).
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
