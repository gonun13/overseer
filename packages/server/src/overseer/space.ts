import type {
  ServerMessage,
  SpaceMessage,
  SpaceService,
  SpaceStatusEntry,
} from "@overseer/protocol";
import { recordAction } from "../memory/internal.js";

/**
 * The overseer space — one door for every service that reports to the
 * operator.
 *
 * Before this, a service that wanted to say something built an
 * `overseer.step` object literal and broadcast it itself. Twelve call sites
 * did that, each with its own `randomUUID()`, each also owing a separate
 * `recordAction` call, and none of them able to revise a line another had
 * already written. That is why `checking provider auth... [BLOCKED]` outlived
 * the login that fixed it.
 *
 * Three things change here:
 *
 * 1. **Rows have owners and identity.** Every row is attributed to a
 *    `SpaceService` and keyed within it, so a later report can find the
 *    earlier one.
 * 2. **States supersede, events accumulate.** See `SpaceStatusMode` — a
 *    condition is re-reported and replaces itself; a happening is appended and
 *    stands.
 * 3. **Reporting is recording.** `recordAction` is folded in, so the action
 *    register cannot drift from what the operator was shown by a call site
 *    that remembered one and forgot the other.
 *
 * Deliberately not an `EventEmitter`: the server has none anywhere, and the
 * established shape for a module that pushes to every tab is an injected
 * `broadcast` (see `usage-refresh.ts`).
 */
export interface OverseerSpace {
  /** Report a row. `state` supersedes by `(service, key)`; `event` appends. */
  status(entry: StatusInput): void;
  /** The condition is over. Drops the service's `state` rows — all of them, or
   * just `key`. Never touches event history, which is a record. */
  clear(service: SpaceService, key?: string): void;
  /** Throw a one-liner at the operator. */
  say(message: SpaceMessage): void;
  /** Current `state` rows and the last message, for a tab that just connected.
   * Event history is deliberately not replayed — a joining tab has no business
   * being told about a git commit that happened before it existed. */
  replay(): { entries: SpaceStatusEntry[]; message?: SpaceMessage };
}

/** What a caller supplies. `at` is stamped here so no call site can report a
 * time that disagrees with the register, and `mode` defaults to `event`: a row
 * whose author did not think about supersession is a happening, not a
 * condition, and appending is the safe reading. */
export type StatusInput = Omit<SpaceStatusEntry, "at" | "mode"> & {
  mode?: SpaceStatusEntry["mode"];
  /**
   * What to write to the action register, when this row is worth recording.
   * Omitted means "shown but not recorded" — a probe or a re-report of a
   * condition that has not actually changed.
   */
  action?: string;
  /** Who caused it. Defaults to the overseer acting on its own. */
  actor?: "overseer" | "operator";
};

export function createOverseerSpace(
  broadcast: (message: ServerMessage) => void,
): OverseerSpace {
  /**
   * Live `state` rows, keyed `service:key`. A Map rather than an array because
   * supersession is the common write and ordering is derived on read.
   */
  const states = new Map<string, SpaceStatusEntry>();
  let lastMessage: SpaceMessage | undefined;

  const status = (input: StatusInput) => {
    const entry = buildStatusEntry(input);
    const { action, actor } = input;
    const mode = entry.mode;

    if (mode === "state") {
      const id = `${entry.service}:${entry.key}`;
      const before = states.get(id);
      // A condition re-reported unchanged is not news. Dropping it here is
      // what keeps a periodic re-check from stuttering the window open (see
      // the "does not re-summon itself" rule in overseer-behavior.md §3).
      if (
        before !== undefined &&
        before.outcome === entry.outcome &&
        before.label === entry.label &&
        before.detail === entry.detail
      ) {
        return;
      }
      states.set(id, entry);
    }

    // A row still in flight has no outcome to record — the register wants how
    // things ended, and this one has not.
    if (action !== undefined && entry.outcome !== "running") {
      void recordAction({
        actor: actor ?? "overseer",
        action,
        outcome: entry.outcome,
        ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      });
    }

    broadcast({ type: "space.status", entry });
  };

  const clear = (service: SpaceService, key?: string) => {
    if (key !== undefined) {
      if (!states.delete(`${service}:${key}`)) return;
    } else {
      let found = false;
      // Compare the entry's own service rather than the key's prefix — the
      // key is caller-supplied and may contain anything, colons included.
      for (const [id, entry] of [...states]) {
        if (entry.service !== service) continue;
        states.delete(id);
        found = true;
      }
      if (!found) return;
    }
    broadcast({
      type: "space.status.clear",
      service,
      ...(key !== undefined ? { key } : {}),
    });
  };

  const say = (message: SpaceMessage) => {
    lastMessage = message;
    broadcast({ type: "space.message", message });
  };

  const replay = () => ({
    entries: [...states.values()],
    ...(lastMessage !== undefined ? { message: lastMessage } : {}),
  });

  return { status, clear, say, replay };
}

/**
 * Build a well-formed row without broadcasting it.
 *
 * For the handful of reports that are scoped to one socket rather than the
 * instance — the memory wipe, whose steps drive that operator's own furniture
 * teardown one row at a time and must not tear down anyone else's.
 */
export function buildStatusEntry(input: StatusInput): SpaceStatusEntry {
  const { action: _action, actor: _actor, mode = "event", ...rest } = input;
  return { ...rest, mode, at: new Date().toISOString() };
}
