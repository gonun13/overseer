import type { RejectedCustomization } from "@overseer/protocol";
import { ACTIVITY_HEADLINE, ACTIVITY_RANK, type Activity } from "../status";
import type { WindowKind } from "../windows";
import type { Approval, Capability, Project, Session } from "../domain";

/** Where a signal sends you when you click it. Every signal is actionable —
 * a message the operator can't act on is noise (design-system.md §4). */
export type Target =
  | { kind: "window"; window: WindowKind; payload?: string }
  | { kind: "settings" }
  | { kind: "selector" }
  | { kind: "prompt" };

export interface Signal {
  id: string;
  activity: Activity;
  /** Uppercase micro-label: the category. */
  kicker: string;
  /** Sentence-case line: what happened and what it means. */
  text: string;
  target: Target;
}

export interface WorldState {
  projects: Project[];
  activeProject?: Project;
  sessions: Session[];
  approvals: Approval[];
  capabilities: Capability[];
  adapter: { name: string; authenticated: boolean; usage: number };
  busy: boolean;
  /** Customizations in `overseer-personality` the overseer refused to apply.
   * Optional because a world that has not run discovery has not been told. */
  rejected?: RejectedCustomization[];
}

/**
 * The whole point of the overseer space: turn raw state into a ranked list of
 * things the operator should look at, most urgent first. Nothing here is stored —
 * signals are derived on every render so they can never go stale.
 */
export function deriveSignals(world: WorldState): Signal[] {
  const signals: Signal[] = [];
  const { activeProject, sessions, approvals, capabilities, adapter } = world;

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

  if (!activeProject) {
    signals.push({
      id: "no-project",
      activity: "waiting",
      kicker: "project",
      text: "No project selected. Every operation runs against the active project.",
      target: { kind: "selector" },
    });
  }

  // An unnamed adapter is one that has never reported in, which is a different
  // problem from a named one that is not signed in — and naming it anyway would
  // put a guess in the most prominent line on the screen.
  if (!adapter.name) {
    signals.push({
      id: "no-adapter",
      activity: "waiting",
      kicker: "adapter",
      text: "No adapter is attached — sessions cannot start.",
      target: { kind: "settings" },
    });
  } else if (!adapter.authenticated) {
    signals.push({
      id: "no-auth",
      activity: "waiting",
      kicker: "adapter",
      text: `${adapter.name} is not authenticated — sessions cannot start until you sign in.`,
      target: { kind: "settings" },
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

  for (const session of sessions) {
    if (session.activity === "idle" || session.activity === "attention")
      continue;
    signals.push({
      id: `session-${session.id}`,
      activity: session.activity,
      kicker: "session",
      text: `${session.name} — ${session.doing}.`,
      target: { kind: "window", window: "sessions" },
    });
  }

  if (adapter.usage >= 0.8) {
    signals.push({
      id: "usage",
      activity: adapter.usage >= 0.95 ? "attention" : "waiting",
      kicker: "usage",
      text: `${Math.round(adapter.usage * 100)}% of the plan window is spent.`,
      target: { kind: "settings" },
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "standby",
      activity: "idle",
      kicker: "standby",
      text: activeProject
        ? `Nothing is running in ${activeProject.name}. Type below to start a turn.`
        : "Nothing is running.",
      target: { kind: "prompt" },
    });
  }

  return signals.sort(
    (a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity],
  );
}

/** The single word above the signal list. Driven by the most urgent signal, so
 * the headline and the list can never disagree. */
export function headlineFor(
  signals: Signal[],
  busy: boolean,
): { text: string; activity: Activity } {
  const top = signals[0]?.activity ?? "idle";
  if (busy) return { text: ACTIVITY_HEADLINE.working, activity: "working" };
  return { text: ACTIVITY_HEADLINE[top], activity: top };
}
