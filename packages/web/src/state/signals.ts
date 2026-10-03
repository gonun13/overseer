import type {
  AdapterUsageWindow,
  ConsoleInfo,
  SpaceMessageKey,
  RejectedCustomization,
  UntrackedFolder,
} from "@overseer/protocol";
import {
  ACTIVITY_MESSAGE_KEY,
  ACTIVITY_RANK,
  type Activity,
} from "../status.ts";
import type { WindowKind } from "../windows";
import { exitedBadly } from "./console-light.ts";
import type { Project } from "../domain";

/** Where a signal sends you when you click it. Every signal is actionable —
 * a message the operator can't act on is noise (spec/ui-ux.md §4). */
export type Target =
  | { kind: "window"; window: WindowKind; payload?: string }
  | { kind: "settings" }
  | { kind: "selector" }
  /** Starts a new console session — same as + new session. Standby uses this
   * so the click is the work, not a detour to the prompt or the panel. */
  | { kind: "session" }
  /** Brings one console's window up. */
  | { kind: "console"; id: string }
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
  /** Optional message override. When this signal is on top, `messageFor` uses
   * this verbatim instead of the tone pack's line for `activity` — so a
   * rescued personality can read `danger` / `braindead` / `why???` without
   * inventing a sixth activity.
   *
   * Verbatim is the point: these are alarm words, and a tone pack that could
   * soften one would be changing severity, which personality may never do
   * (spec/behaviour/overseer.md §2.3). */
  message?: string;
}

export interface WorldState {
  projects: Project[];
  activeProject?: Project;
  /** Every console the server runs, in any project. */
  consoles: ConsoleInfo[];
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
  /** Stable pick for the alarm message — set once when the complaint lands. */
  personalityRescueMessage?: string;
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
  const { activeProject, consoles, provider } = world;

  // A customization the operator wrote that did not take effect. Reported, not
  // dropped: silently ignoring it leaves them believing it worked, which is
  // worse than refusing it out loud (spec/behaviour/overseer.md §6.4).
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
      message: world.personalityRescueMessage ?? "danger",
    });
  } else if (world.personalityRescued) {
    signals.push({
      id: "personality-rescued",
      activity: "attention",
      kicker: "personality",
      text: "overseer-personality was deleted · restored with defaults.",
      target: { kind: "selector" },
      message: world.personalityRescueMessage ?? "danger",
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
    // taken (spec/behaviour/overseer.md §2.2).
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

  // A CLI waiting on the operator — a permission prompt, a question. Nothing
  // happens in that console until someone looks at it, so each one is its own
  // signal pointing straight at its window. Only hooked CLIs can say this;
  // the rest show up as working or idle.
  for (const c of consoles) {
    if (c.status !== "running" || c.activity !== "waiting") continue;
    signals.push({
      id: `waiting-${c.id}`,
      activity: "approval",
      kicker: "approval",
      text: `${c.title} is waiting for you.`,
      target: { kind: "console", id: c.id },
    });
  }

  // The overseer is an independent unit, not a narrator of every console — an
  // agent working is doing exactly what it is supposed to and earns no signal
  // of its own (spec/behaviour/overseer.md §3). A process that died with an error is
  // something the operator did not already know to expect.
  for (const c of consoles) {
    if (!exitedBadly(c)) continue;
    signals.push({
      id: `exited-${c.id}`,
      activity: "attention",
      kicker: "console",
      text: `${c.title} exited with code ${c.exitCode ?? "?"}.`,
      target: { kind: "console", id: c.id },
    });
  }

  const hottest = hottestUsage(provider.usage);
  if (provider.name && hottest && hottest.used >= 0.8) {
    const atLimit = hottest.used >= 1;
    signals.push({
      id: "usage",
      activity: atLimit ? "waiting" : "attention",
      kicker: "usage",
      text: atLimit
        ? `${provider.name} · ${hottest.label} limit reached · sessions cannot start until it resets.`
        : `${provider.name} · ${Math.round(hottest.used * 100)}% of the ${hottest.label} window is spent.`,
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

/**
 * The one-liner above the signal list. Driven by the most urgent signal, so
 * the message and the list can never disagree — and by nothing else. A session
 * working normally is not a reason for the overseer to speak up: the overseer
 * is an independent unit, not a mirror of whatever a session happens to be
 * doing (spec/behaviour/overseer.md §3).
 *
 * Returns what to say, not the words. The caller resolves `key` against the
 * operator's tone pack; `text` is only set when a signal supplied a verbatim
 * override. `activity` travels either way, because it is what the status light
 * beside the line reads — the severity the uppercase word used to carry.
 */
export function messageFor(signals: Signal[]): {
  key: SpaceMessageKey;
  activity: Activity;
  text?: string;
} {
  const top = signals[0];
  const activity = top?.activity ?? "idle";
  return {
    key: ACTIVITY_MESSAGE_KEY[activity],
    activity,
    ...(top?.message !== undefined ? { text: top.message } : {}),
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
