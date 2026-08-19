import type {
  AdapterUsageWindow,
  RejectedCustomization,
  UntrackedFolder,
} from "@overseer/protocol";
import { ACTIVITY_HEADLINE, ACTIVITY_RANK, type Activity } from "../status";
import type { WindowKind } from "../windows";
import type { Approval, Capability, Project, Session } from "../domain";

/** Where a signal sends you when you click it. Every signal is actionable —
 * a message the operator can't act on is noise (design-system.md §4). */
export type Target =
  | { kind: "window"; window: WindowKind; payload?: string }
  | { kind: "settings" }
  | { kind: "selector" }
  /** Starts a conversation — same as + new session. Standby uses this so the
   * click is the work, not a detour to the prompt or the sessions list. */
  | { kind: "session" }
  /** The login surface — opens the providers window on its authenticate step
   * *and* starts the flow, so following the signal is one click, not two. */
  | { kind: "login" }
  /** Full boot — used when `overseer-personality` must be restored by discovery. */
  | { kind: "restart" };

export interface Signal {
  id: string;
  activity: Activity;
  /** Uppercase micro-label: the category. */
  kicker: string;
  /** Sentence-case line: what happened and what it means. */
  text: string;
  target: Target;
  /** Optional system-headline override. When this signal is on top,
   * `headlineFor` uses it instead of `ACTIVITY_HEADLINE[activity]` — so a
   * rescued personality can read `DANGER` / `BRAINDEAD` / `WHY???` without
   * inventing a sixth activity. */
  headline?: string;
}

export interface WorldState {
  projects: Project[];
  activeProject?: Project;
  sessions: Session[];
  approvals: Approval[];
  capabilities: Capability[];
  provider: {
    name: string;
    authenticated: boolean;
    usage: AdapterUsageWindow[];
    /** False when the provider runtime could not be reached. */
    reachable?: boolean;
    detail?: string;
    /** True when this instance was signed in and now is not. */
    authExpired?: boolean;
  };
  /** Customizations in `overseer-personality` the overseer refused to apply.
   * Optional because a world that has not run discovery has not been told. */
  rejected?: RejectedCustomization[];
  /** True when `overseer-personality` is missing and the operator must restart. */
  personalityMissing?: boolean;
  /** True when discovery restored it from defaults after a deletion. */
  personalityRescued?: boolean;
  /** Stable pick for the alarm headline — set once when the complaint lands. */
  personalityRescueHeadline?: string;
  /** Workspace folders that are not git projects. */
  untrackedFolders?: UntrackedFolder[];
}

/**
 * The whole point of the overseer space: turn raw state into a ranked list of
 * things the operator should look at, most urgent first. Nothing here is stored —
 * signals are derived on every render so they can never go stale.
 */
export function deriveSignals(world: WorldState): Signal[] {
  const signals: Signal[] = [];
  const { activeProject, sessions, approvals, capabilities, provider } = world;

  // A customization the operator wrote that did not take effect. Reported, not
  // dropped: silently ignoring it leaves them believing it worked, which is
  // worse than refusing it out loud (docs/overseer.md §6.4).
  for (const rejection of world.rejected ?? []) {
    signals.push({
      id: `personality-${rejection.field}`,
      activity: "waiting",
      kicker: "personality",
      text: `"${rejection.field}" in overseer-personality was not applied: ${rejection.reason}.`,
      target: { kind: "selector" },
    });
  }

  // Required infrastructure. Live deletion asks for a restart; discovery on
  // the next boot recreates defaults. Never a silent live repair.
  if (world.personalityMissing) {
    signals.push({
      id: "personality-missing",
      activity: "attention",
      kicker: "personality",
      text: "personality was deleted · restart to restore.",
      target: { kind: "restart" },
      headline: world.personalityRescueHeadline ?? "danger",
    });
  } else if (world.personalityRescued) {
    signals.push({
      id: "personality-rescued",
      activity: "attention",
      kicker: "personality",
      text: "overseer-personality was deleted · restored with defaults.",
      target: { kind: "selector" },
      headline: world.personalityRescueHeadline ?? "danger",
    });
  }

  // A folder under /workspace without .git is invisible to the project panel
  // until the operator inits a repo — say so rather than leaving them guessing.
  for (const folder of world.untrackedFolders ?? []) {
    signals.push({
      id: `untracked-${folder.path}`,
      activity: "waiting",
      kicker: "workspace",
      text: `"${folder.name}" is in the workspace but is not a git project · it will not appear in the project list until you run git init.`,
      target: { kind: "selector" },
    });
  }

  if (!activeProject) {
    signals.push({
      id: "no-project",
      activity: "waiting",
      kicker: "project",
      text: "No project selected. Every operation runs against the active project.",
      target: { kind: "selector" },
    });
  }

  // An unnamed provider is one that has never reported in, which is a different
  // problem from a named one that is not signed in — and naming it anyway would
  // put a guess in the most prominent line on the screen.
  if (!provider.name) {
    signals.push({
      id: "no-provider",
      activity: "waiting",
      kicker: "provider",
      text: "No provider is attached · sessions cannot start.",
      target: { kind: "window", window: "providers" },
    });
  } else if (provider.authExpired) {
    // A provider that *was* signed in and now is not did not lose its
    // credential because of anything the operator did, and everything
    // downstream of it is about to start failing. Its own signal, ranked above
    // "you have not signed in yet", because it is news rather than a step not
    // taken (docs/overseer.md §2.2).
    signals.push({
      id: "auth-expired",
      activity: "attention",
      kicker: "provider",
      text: `${provider.name} was signed in and is not any more · its credential expired or was revoked. sign in again to keep working.`,
      target: { kind: "login" },
    });
  } else if (provider.reachable === false) {
    signals.push({
      id: "provider-unreachable",
      activity: "attention",
      kicker: "provider",
      text: provider.detail
        ? `${provider.name} is unreachable · ${provider.detail}.`
        : `${provider.name} is unreachable · the provider runtime did not answer.`,
      target: { kind: "window", window: "providers" },
    });
  } else if (!provider.authenticated) {
    signals.push({
      id: "no-auth",
      activity: "waiting",
      kicker: "provider",
      text: `${provider.name} is not authenticated · sessions cannot start until you sign in.`,
      target: { kind: "login" },
    });
  }

  if (approvals.length > 0) {
    signals.push({
      id: "approvals",
      activity: "attention",
      kicker: "approval",
      text:
        approvals.length === 1
          ? `${approvals[0].tool} wants to run in ${approvals[0].session} and is waiting on you.`
          : `${approvals.length} tool calls are waiting on your decision.`,
      target: { kind: "window", window: "approvals" },
    });
  }

  for (const capability of capabilities) {
    if (!capability.problem) continue;
    signals.push({
      id: `cap-${capability.id}`,
      activity: capability.activity,
      kicker: "capability",
      text: `${capability.name} (${capability.kind}) is unusable: ${capability.problem}.`,
      target: { kind: "window", window: "capabilities" },
    });
  }

  // The overseer is an independent unit, not a narrator of every session — a
  // session generating a reply is doing exactly what it is supposed to and
  // earns no signal of its own (docs/overseer.md §3). Only a session that hit
  // real trouble (a denied permission, a stream error — anything that landed
  // it on `attention`) is something the operator did not already know to
  // expect, so only that state is reported here.
  for (const session of sessions) {
    if (session.activity !== "attention") continue;
    signals.push({
      id: `session-${session.id}`,
      activity: session.activity,
      kicker: "session",
      text: `${session.name} · ${session.doing}.`,
      target: { kind: "window", window: "sessions" },
    });
  }

  const hottest = hottestUsage(provider.usage);
  if (hottest && hottest.used >= 0.8) {
    signals.push({
      id: "usage",
      activity: hottest.used >= 0.95 ? "attention" : "waiting",
      kicker: "usage",
      text: `${Math.round(hottest.used * 100)}% of the ${hottest.label} window is spent.`,
      target: { kind: "window", window: "providers" },
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "standby",
      activity: "idle",
      kicker: "standby",
      text: activeProject
        ? `Nothing is running in ${activeProject.name}. Start new session.`
        : "Nothing is running.",
      target: { kind: "session" },
    });
  }

  return signals.sort(
    (a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity],
  );
}

/** The single word above the signal list. Driven by the most urgent signal, so
 * the headline and the list can never disagree — and by nothing else. A
 * session working normally is not a reason for the overseer to say
 * "working": the overseer is an independent unit, not a mirror of whatever a
 * session happens to be doing (docs/overseer.md §3). A signal may carry its
 * own headline word (personality rescue); otherwise the activity vocabulary. */
export function headlineFor(signals: Signal[]): { text: string; activity: Activity } {
  const top = signals[0];
  const activity = top?.activity ?? "idle";
  return {
    text: top?.headline ?? ACTIVITY_HEADLINE[activity],
    activity,
  };
}

function hottestUsage(
  windows: AdapterUsageWindow[],
): AdapterUsageWindow | undefined {
  let hottest: AdapterUsageWindow | undefined;
  for (const window of windows) {
    if (hottest === undefined || window.used > hottest.used) hottest = window;
  }
  return hottest;
}
