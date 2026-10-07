import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  ConsoleActivity,
  ConsoleInfo,
  HeldRelay,
  RelayState,
  ServerMessage,
  SessionMeta,
} from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import type { CallsignBook } from "./callsigns.js";
import type { ConsoleRegistry } from "./console-registry.js";
import type { OverseerSpace } from "./overseer/space.js";

/**
 * Relay — typing a prompt into an agent console on someone's behalf
 * (spec/behaviour/relay.md).
 *
 * The overseer routes; it does not converse. A relay is queued on its target
 * console and typed only when that console is idle with no operator draft in
 * its prompt (domain invariant 13), one per turn so two prompts never collide.
 * Everything that happens to one is reported to the overseer space.
 */

/** Who a relay is from. An agent is identified by the console it relays as. */
export type RelaySender =
  { kind: "operator" } | { kind: "agent"; consoleId: string; callsign: string };

export interface RelayOutcome {
  state: RelayState;
  /** The target's callsign as it is shown, when one was found. */
  to: string;
  reason?: string;
}

export interface RelayLimits {
  /** Relays one agent may send per `windowMs`. */
  rateMax: number;
  windowMs: number;
  /** Minimum gap between one agent's relays to the same target. */
  cooldownMs: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  rateMax: 6,
  windowMs: 10 * 60_000,
  cooldownMs: 30_000,
};

/** How long a typed relay may go without the CLI starting a turn before the
 * queue stops waiting for one — a prompt the TUI swallowed must not stall it. */
const TURN_TIMEOUT_MS = 15_000;

/**
 * How long a console must have been idle before a relay is typed. A CLI
 * reports idle before its TUI takes input — Claude Code's `SessionStart` hook
 * fires while the prompt is still drawing, and a paste then is lost.
 */
const SETTLE_MS = 1_500;

/** Size a woken console starts at; the first window to attach resizes it. */
const WAKE_SIZE = { cols: 120, rows: 32 };

/** First characters of a relay, for the register and the held signal. */
const EXCERPT_CHARS = 60;

export interface RelayDeps {
  consoles: Pick<ConsoleRegistry, "list" | "input" | "open" | "setPending">;
  callsigns: CallsignBook;
  /** Every listed session — how a dormant callsign is found and woken. */
  sessions: () => SessionMeta[];
  space: Pick<OverseerSpace, "status" | "clear">;
  broadcast: (message: ServerMessage) => void;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  limits?: RelayLimits;
  turnTimeoutMs?: number;
  settleMs?: number;
  now?: () => number;
}

export interface Relay {
  relay(request: {
    to: string;
    text: string;
    from: RelaySender;
  }): Promise<RelayOutcome>;
  /** Keystrokes the operator typed into a console — the draft guard. */
  noteInput(id: string, data: string): void;
  onActivity(id: string, activity: ConsoleActivity): void;
  onExit(id: string): void;
  /** Release (`true`) or drop an agent relay held past its limits. */
  release(heldId: string, release: boolean): Promise<RelayOutcome | undefined>;
  held(): HeldRelay[];
  /** The roster `overseer who` prints. */
  roster(): RosterEntry[];
  dispose(): void;
}

export interface RosterEntry {
  callsign: string;
  project: string;
  activity: ConsoleActivity | "dormant";
  title?: string;
  running: boolean;
}

interface Pending {
  /** Exactly what is typed — an agent's relay is already framed. */
  text: string;
  /** The relay as asked, for the register. */
  raw: string;
  to: string;
  from: RelaySender;
}

interface ConsoleState {
  queue: Pending[];
  /** Printable characters typed since the last Enter or Ctrl+C — an
   * estimate, which is all a terminal's input stream allows. */
  draft: number;
  /** A relay was typed and the CLI has not started its turn yet. */
  awaitingTurn: boolean;
  turnTimer?: ReturnType<typeof setTimeout>;
  /** When this console last turned idle, if it did while we watched. */
  idleSince?: number;
  settleTimer?: ReturnType<typeof setTimeout>;
}

interface HeldEntry {
  held: HeldRelay;
  from: Extract<RelaySender, { kind: "agent" }>;
  /** The relay as asked, before framing. */
  text: string;
}

/** Escape sequences carry printable bytes that are not typing: arrows,
 * focus reports, mouse, bracketed-paste markers. */
const ESCAPES = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1bO.|\x1b[^[O]/g;

/**
 * The draft estimate after `data` was typed. Enter and Ctrl+C clear it,
 * Ctrl+U too; backspace takes one off; anything printable adds. Cursor moves
 * and mid-line edits make this approximate — it errs toward "there is a draft".
 */
export function nextDraft(draft: number, data: string): number {
  let count = draft;
  for (const ch of data.replace(ESCAPES, "")) {
    if (ch === "\r" || ch === "\n" || ch === "\x03" || ch === "\x15") count = 0;
    else if (ch === "\x7f" || ch === "\b") count = Math.max(0, count - 1);
    else if (ch >= " ") count += 1;
  }
  return count;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_CHARS
    ? flat
    : `${flat.slice(0, EXCERPT_CHARS - 1)}…`;
}

function projectName(projectPath: string): string {
  return projectPath.split("/").filter(Boolean).pop() ?? projectPath;
}

function rowKey(callsign: string): string {
  return callsign.toLowerCase();
}

function label(callsign: string): string {
  return `relaying to ${callsign.toLowerCase()}...`;
}

export function createRelay(deps: RelayDeps): Relay {
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const limits = deps.limits ?? DEFAULT_RELAY_LIMITS;
  const turnTimeoutMs = deps.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const now = deps.now ?? (() => Date.now());

  const states = new Map<string, ConsoleState>();
  const held = new Map<string, HeldEntry>();
  /** Accepted agent relays per sender callsign (lowercased), as times. */
  const sent = new Map<string, number[]>();
  /** Last accepted relay per `from→to` pair (lowercased). */
  const lastPair = new Map<string, number>();

  const stateOf = (id: string): ConsoleState => {
    let state = states.get(id);
    if (state === undefined) {
      state = { queue: [], draft: 0, awaitingTurn: false };
      states.set(id, state);
    }
    return state;
  };

  const sessionOf = (id: string): SessionMeta | undefined =>
    deps.sessions().find((s) => s.id === id);

  const consoleOf = (id: string): ConsoleInfo | undefined =>
    deps.consoles.list().find((c) => c.id === id);

  const runningAgent = (callsign: string): ConsoleInfo | undefined => {
    const needle = callsign.toLowerCase();
    return deps.consoles
      .list()
      .find(
        (c) =>
          c.kind === "agent" &&
          c.status === "running" &&
          c.callsign?.toLowerCase() === needle,
      );
  };

  /**
   * What the register keeps: the action, who did it, and one detail that is
   * also the row's — `linda · <what>` for the operator's relays,
   * `bob→linda · <what>` for an agent's. `what` is an excerpt or a reason.
   */
  const record = (from: RelaySender, to: string, what: string) =>
    from.kind === "operator"
      ? {
          action: "console:relay",
          actor: "operator" as const,
          detail: `${to.toLowerCase()} · ${what}`,
        }
      : {
          action: "agent:relay",
          actor: "overseer" as const,
          detail: `${from.callsign.toLowerCase()}→${to.toLowerCase()} · ${what}`,
        };

  const refuse = (
    to: string,
    reason: string,
    from: RelaySender,
  ): RelayOutcome => {
    deps.space.status({
      service: "relay",
      key: "refused",
      mode: "event",
      label: label(to),
      outcome: "failed",
      ...record(from, to, reason),
    });
    return { state: "refused", to, reason };
  };

  /** The queued/blocked condition row for one console's target. */
  const reportWaiting = (info: ConsoleInfo, state: ConsoleState) => {
    const callsign = info.callsign ?? "";
    if (state.queue.length === 0) {
      deps.space.clear("relay", rowKey(callsign));
      return;
    }
    const drafting =
      info.activity === "idle" && !state.awaitingTurn && state.draft > 0;
    deps.space.status({
      service: "relay",
      key: rowKey(callsign),
      mode: "state",
      label: label(callsign),
      outcome: drafting ? "blocked" : "running",
      detail: drafting
        ? "operator draft in the prompt"
        : `${state.queue.length} queued · ${info.activity}`,
    });
  };

  const cancelTurnTimer = (state: ConsoleState) => {
    if (state.turnTimer !== undefined) clearTimeout(state.turnTimer);
    delete state.turnTimer;
  };

  const cancelSettleTimer = (state: ConsoleState) => {
    if (state.settleTimer !== undefined) clearTimeout(state.settleTimer);
    delete state.settleTimer;
  };

  /** Type the next relay if the console can take it now. True if typed. */
  const flush = (id: string): boolean => {
    const state = states.get(id);
    const info = consoleOf(id);
    if (state === undefined || info === undefined) return false;
    if (state.queue.length === 0 || info.status !== "running") return false;
    if (info.activity !== "idle" || state.awaitingTurn || state.draft > 0) {
      reportWaiting(info, state);
      return false;
    }
    // Idle, but only just: let the TUI finish drawing its prompt. A console
    // idle since before we watched it has long settled.
    const settling =
      state.idleSince === undefined ? 0 : settleMs - (now() - state.idleSince);
    if (settling > 0) {
      if (state.settleTimer === undefined) {
        state.settleTimer = setTimeout(() => {
          delete state.settleTimer;
          flush(id);
        }, settling);
      }
      reportWaiting(info, state);
      return false;
    }
    const adapter =
      info.providerId !== undefined ? getAdapterFn(info.providerId) : undefined;
    const next = state.queue.shift()!;
    if (adapter?.relayInput === undefined) {
      // Checked when queued; only a provider swapped under a live console
      // gets here.
      refuse(
        next.to,
        `${info.providerId ?? "this console"} cannot take relayed prompts`,
        next.from,
      );
    } else {
      deps.consoles.input(id, adapter.relayInput(next.text));
      state.awaitingTurn = true;
      state.turnTimer = setTimeout(() => {
        delete state.turnTimer;
        state.awaitingTurn = false;
        flush(id);
      }, turnTimeoutMs);
      deps.space.status({
        service: "relay",
        key: "delivered",
        mode: "event",
        label: label(next.to),
        outcome: "ok",
        ...record(next.from, next.to, excerpt(next.raw)),
      });
    }
    deps.consoles.setPending(id, state.queue.length);
    reportWaiting(info, state);
    return true;
  };

  const enqueue = (id: string, pending: Pending): RelayState => {
    const state = stateOf(id);
    state.queue.push(pending);
    deps.consoles.setPending(id, state.queue.length);
    // Typed now only if nothing was waiting ahead of it.
    if (state.queue.length === 1 && flush(id)) return "delivered";
    return "queued";
  };

  const framed = (from: RelaySender, text: string) =>
    from.kind === "agent" ? `[from ${from.callsign}] ${text}` : text;

  const broadcastHeld = () =>
    deps.broadcast({
      type: "relay.held",
      held: [...held.values()].map((h) => h.held),
    });

  /** Over a limit — the relay waits on the operator (spec §5.2). */
  const overLimit = (
    from: Extract<RelaySender, { kind: "agent" }>,
    to: string,
  ): boolean => {
    const at = now();
    const sender = from.callsign.toLowerCase();
    const recent = (sent.get(sender) ?? []).filter(
      (t) => at - t < limits.windowMs,
    );
    sent.set(sender, recent);
    if (recent.length >= limits.rateMax) return true;
    const last = lastPair.get(`${sender}→${to.toLowerCase()}`);
    return last !== undefined && at - last < limits.cooldownMs;
  };

  const countSent = (
    from: Extract<RelaySender, { kind: "agent" }>,
    to: string,
  ) => {
    const at = now();
    const sender = from.callsign.toLowerCase();
    sent.set(sender, [...(sent.get(sender) ?? []), at]);
    lastPair.set(`${sender}→${to.toLowerCase()}`, at);
  };

  const route = async (
    request: { to: string; text: string; from: RelaySender },
    approved: boolean,
  ): Promise<RelayOutcome> => {
    const { from, text } = request;
    await deps.callsigns.ready;
    const key = deps.callsigns.keyOf(request.to);
    if (key === undefined)
      return refuse(request.to, `no agent called ${request.to}`, from);
    const to = deps.callsigns.nameOf(key)!;
    if (text.trim() === "") return refuse(to, "nothing to relay", from);

    if (
      from.kind === "agent" &&
      from.callsign.toLowerCase() === to.toLowerCase()
    ) {
      return refuse(to, "an agent cannot relay to itself", from);
    }

    const running = runningAgent(to);
    const providerId = running?.providerId ?? sessionOf(key)?.adapterId;
    const adapter =
      providerId !== undefined ? getAdapterFn(providerId) : undefined;
    if (adapter?.relayInput === undefined) {
      return refuse(
        to,
        `${providerId ?? to} cannot take relayed prompts`,
        from,
      );
    }

    if (running === undefined) {
      if (from.kind === "agent") {
        return refuse(
          to,
          `${to} is not running · only the operator can wake a session`,
          from,
        );
      }
      const session = sessionOf(key);
      if (session === undefined)
        return refuse(to, `${to} has no session to resume`, from);
      if (session.origin === "loop") {
        return refuse(to, `${to} is a live loop run`, from);
      }
      const opened = await deps.consoles.open({
        kind: "agent",
        projectPath: session.projectDir,
        providerId: session.adapterId,
        sessionId: session.id,
        resume: true,
        ...WAKE_SIZE,
      });
      if (!opened.ok) return refuse(to, opened.reason, from);
      enqueue(opened.console.id, { text, raw: text, to, from });
      return { state: "waking", to };
    }

    if (from.kind === "agent" && !approved) {
      if (overLimit(from, to)) {
        const id = randomUUID();
        held.set(id, {
          held: {
            id,
            from: from.callsign,
            to,
            text: excerpt(text),
            at: new Date(now()).toISOString(),
          },
          from,
          text,
        });
        broadcastHeld();
        deps.space.status({
          service: "relay",
          key: "held",
          mode: "event",
          label: label(to),
          outcome: "blocked",
          detail: `held · ${from.callsign.toLowerCase()} is over its relay limit`,
        });
        return { state: "held", to };
      }
    }
    if (from.kind === "agent") countSent(from, to);

    return {
      state: enqueue(running.id, {
        text: framed(from, text),
        raw: text,
        to,
        from,
      }),
      to,
    };
  };

  const drop = (id: string, reason: string) => {
    const state = states.get(id);
    if (state === undefined) return;
    cancelTurnTimer(state);
    cancelSettleTimer(state);
    for (const pending of state.queue) {
      deps.space.status({
        service: "relay",
        key: "dropped",
        mode: "event",
        label: label(pending.to),
        outcome: "failed",
        ...record(pending.from, pending.to, reason),
      });
    }
    const callsign = state.queue[0]?.to;
    if (callsign !== undefined) deps.space.clear("relay", rowKey(callsign));
    states.delete(id);
  };

  return {
    relay: (request) => route(request, false),

    noteInput(id, data) {
      const state = stateOf(id);
      const before = state.draft;
      state.draft = nextDraft(state.draft, data);
      // A draft cleared is the moment a held relay can go.
      if (before > 0 && state.draft === 0) flush(id);
      else if (before === 0 && state.draft > 0 && state.queue.length > 0) {
        const info = consoleOf(id);
        if (info !== undefined) reportWaiting(info, state);
      }
    },

    onActivity(id, activity) {
      const state = stateOf(id);
      if (activity === "idle") state.idleSince = now();
      else {
        delete state.idleSince;
        cancelSettleTimer(state);
      }
      if (activity !== "idle") {
        // The turn started: whatever was typed has been taken.
        state.awaitingTurn = false;
        cancelTurnTimer(state);
        const info = consoleOf(id);
        if (info !== undefined && state.queue.length > 0)
          reportWaiting(info, state);
        return;
      }
      flush(id);
    },

    onExit(id) {
      drop(id, "console exited");
    },

    async release(heldId, release) {
      const entry = held.get(heldId);
      if (entry === undefined) return undefined;
      held.delete(heldId);
      broadcastHeld();
      if (!release) {
        deps.space.status({
          service: "relay",
          key: "held",
          mode: "event",
          label: label(entry.held.to),
          outcome: "skipped",
          ...record(entry.from, entry.held.to, "dropped by the operator"),
        });
        return {
          state: "refused",
          to: entry.held.to,
          reason: "dropped by the operator",
        };
      }
      return route(
        { to: entry.held.to, text: entry.text, from: entry.from },
        true,
      );
    },

    held: () => [...held.values()].map((h) => h.held),

    roster() {
      const sessions = deps.sessions();
      const titleOf = (id: string | undefined) =>
        id === undefined ? undefined : sessions.find((s) => s.id === id)?.name;
      const live = deps.consoles
        .list()
        .filter(
          (c) =>
            c.kind === "agent" &&
            c.status === "running" &&
            c.callsign !== undefined,
        );
      const entries: RosterEntry[] = live.map((c) => {
        const title = titleOf(c.sessionId);
        return {
          callsign: c.callsign!,
          project: projectName(c.projectPath),
          activity: c.activity,
          running: true,
          ...(title !== undefined ? { title } : {}),
        };
      });
      const liveSessions = new Set(live.map((c) => c.sessionId));
      for (const session of sessions) {
        if (liveSessions.has(session.id) || session.origin === "loop") continue;
        const callsign = deps.callsigns.nameOf(session.id);
        if (callsign === undefined) continue;
        entries.push({
          callsign,
          project: projectName(session.projectDir),
          activity: "dormant",
          running: false,
          ...(session.name !== undefined ? { title: session.name } : {}),
        });
      }
      return entries;
    },

    dispose() {
      for (const state of states.values()) {
        cancelTurnTimer(state);
        cancelSettleTimer(state);
      }
      states.clear();
    },
  };
}
