import type { DiscoveryOutcome } from "./discovery.js";

/**
 * The overseer space: the three surfaces the overseer speaks through, and the
 * one frame family that drives all of them.
 *
 * Before this existed, each surface was governed by its own mechanism — the
 * headline derived per render, signals derived per render, and the status
 * window fed by `overseer.step` object literals hand-rolled at a dozen call
 * sites. Nothing owned a row and nothing could supersede one, so a line
 * written at boot stood for the life of the page even after the fact behind
 * it had changed.
 *
 * Everything here is about giving services one door to report through
 * (docs/overseer-behavior.md §2).
 */

/** The one status vocabulary, shared by every light, row, signal and message.
 *
 * Lives in the protocol rather than the web package because the server now
 * names severity itself: a `SpaceMessage` carries the activity it means, and
 * the client only chooses the words. `packages/web/src/status.ts` re-exports
 * this so the UI's own maps (pulse, rank, step word) stay beside their
 * renderers. */
export type Activity =
  | "idle"
  | "working"
  | "done"
  | "waiting"
  | "attention"
  | "approval";

/** Which service is reporting. A closed union rather than a free string: the
 * whole point of routing through one API is that a row can be attributed, and
 * an unattributable row is the ad-hoc broadcast this replaces. */
export type SpaceService =
  | "discovery"
  | "providers"
  | "workspace"
  | "personality"
  | "git"
  | "memory"
  | "session";

/**
 * Why a row exists, and therefore what may happen to it later.
 *
 * This distinction is the whole fix. A `state` row describes a condition that
 * is true right now — "the provider is not authenticated", "the prompt is
 * held" — so a later report on the same key replaces it in place and the row
 * can never contradict the world. An `event` row describes something that
 * happened at a point in time — "committed foo", "generated an ssh key" — so
 * it is immutable and append-only, and a second one never overwrites the
 * first.
 *
 * Treating states as events is what let `checking provider auth... [BLOCKED]`
 * survive a successful login.
 */
export type SpaceStatusMode = "state" | "event";

/** How a row stands: the discovery vocabulary, plus in-flight. */
export type SpaceOutcome = DiscoveryOutcome | "running";

/** One row in the status window. */
export interface SpaceStatusEntry {
  service: SpaceService;
  /**
   * Stable within a service, and the supersession key for `state` rows: a
   * second `state` report on the same `(service, key)` replaces the first
   * rather than stacking under it.
   *
   * `event` rows also carry one — it names what kind of event this was, which
   * is what lets a service clear a run of them — but two events with the same
   * key coexist happily.
   */
  key: string;
  /** Telegraphic, lowercase, present participle. The operations register, and
   * the one surface where personality is never allowed (§2.3). */
  label: string;
  /**
   * How the row stands. `running` is the one value `DiscoveryOutcome` has no
   * word for — a check that has started and not yet come back — and it is a
   * real state of a row, not a fourth way for one to end.
   */
  outcome: SpaceOutcome;
  /** One short clause of context. Paths, errors and ids verbatim. */
  detail?: string;
  mode: SpaceStatusMode;
  /** ISO instant the row was reported. Ordering for `event` rows. */
  at: string;
}

/**
 * A one-liner the overseer throws at the operator.
 *
 * The server names *what happened* and how severe it is; the client renders it
 * in the operator's tone. That split is deliberate and is what keeps the
 * personality boundary intact: tone selects a phrasing pack, and cannot reach
 * `activity` or invent a key (§2.3, and the `FORBIDDEN` map in
 * `memory/personality/validate.ts`).
 */
export interface SpaceMessage {
  key: SpaceMessageKey;
  /** Severity. Drives the status light and the rule, never the words. */
  activity: Activity;
  /** Substituted into the tone pack's template — `{name}` and friends. */
  vars?: Record<string, string>;
  /**
   * Text that must survive re-wording: a path, an error, a tool name. Rendered
   * beside the toned line rather than through it, because a tone pack that
   * could rewrite an error message would make the error useless.
   */
  verbatim?: string;
}

/**
 * Every line the message surface can show. Closed, because both sides have to
 * agree: the server picks a key and the client holds three phrasings of it.
 *
 * The first group is steady state, chosen from the ranked signal list — these
 * are what replaced the single uppercase activity word. The second is the
 * wizard's own beats. The third is the overseer reacting to something that
 * happened rather than describing what is.
 */
export type SpaceMessageKey =
  // Steady state — one per `Activity`, chosen from the top-ranked signal.
  | "idle"
  | "ready"
  | "working"
  | "blocked"
  | "attention"
  | "approval"
  // Wizard beats.
  | "starting"
  | "connecting"
  | "intro"
  | "namePrefix"
  | "tonePrompt"
  | "welcome"
  | "welcomeBack"
  | "lookingAround"
  | "resetAsk"
  | "resetDeclined"
  | "resetWorking"
  | "resetGoodbye"
  // Reactions the server raises through `space.say()`.
  | "authRestored"
  | "authLost";

/**
 * Space traffic. Broadcast, unlike discovery — a change to the world is a fact
 * every open tab should see, not just the one that asked. `space.replay`
 * catches a tab up on connect: current `state` rows and the last message, with
 * the event history deliberately left behind (a joining tab has no business
 * replaying a git commit that happened before it existed).
 */
export type SpaceFrame =
  | { type: "space.status"; entry: SpaceStatusEntry }
  | {
      type: "space.status.clear";
      service: SpaceService;
      /** Omitted clears every row the service owns. */
      key?: string;
    }
  | { type: "space.message"; message: SpaceMessage }
  | {
      type: "space.replay";
      entries: SpaceStatusEntry[];
      message?: SpaceMessage;
    };
