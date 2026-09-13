import type {
  DiscoveryEvent,
  SpaceFrame,
  SpaceMessage,
  SpaceService,
  SpaceStatusEntry,
} from "@overseer/protocol";

/**
 * The client half of the overseer space.
 *
 * One store behind all three surfaces, so they cannot disagree about the
 * world. Before this, the status window was an append-only array in
 * `wizard.steps` while signals were derived per render — which is why a login
 * fixed the signal list and left `checking provider auth... [BLOCKED]`
 * standing in the window above it.
 *
 * Rows are held in two buckets because they mean different things (see
 * `SpaceStatusMode`): `state` rows are a keyed map of conditions that hold
 * right now, and `event` rows are an ordered log of things that happened.
 * Reading puts the conditions first — what is true outranks what occurred.
 */

export interface SpaceState {
  /** Conditions, keyed `service:key`. Insertion order is first-report order,
   * which keeps a pass reading top-to-bottom as it ran. */
  states: Map<string, SpaceStatusEntry>;
  /** Happenings, oldest first. */
  events: SpaceStatusEntry[];
  /** The last thing the overseer said, when the server said it. The wizard and
   * the signal list can both outrank this — see `useShellPresentation`. */
  message?: SpaceMessage;
  /**
   * Bumped whenever a row *appears*. Drives the auto-summon in
   * `useShellPresentation`.
   *
   * Deliberately not bumped when a `state` row is revised: a row correcting
   * itself is the window doing its job, not new work starting, and re-opening
   * a window the operator closed over it would break the "does not re-summon
   * itself" rule (docs/overseer-behavior.md §3).
   */
  tick: number;
}

/** A space with nothing in it. A factory rather than a shared constant: the
 * `states` Map would otherwise be one object handed to every caller, and a
 * single stray mutation would reach every state that ever started from it. */
export function emptySpace(): SpaceState {
  return { states: new Map(), events: [], tick: 0 };
}

export const EMPTY_SPACE: SpaceState = emptySpace();

/** How many event rows to keep. The window is a view of current work, not an
 * archive — the action register is the archive. */
const MAX_EVENTS = 200;

/** Service order for reading `state` rows out. Roughly the order discovery
 * runs in, so the window reads the way the pass did. */
const SERVICE_ORDER: SpaceService[] = [
  "discovery",
  "workspace",
  "personality",
  "providers",
  "session",
  "git",
  "memory",
];

/** The rows the status window renders, conditions first. */
export function spaceRows(space: SpaceState): SpaceStatusEntry[] {
  const states = [...space.states.values()].sort(
    (a, b) => SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(b.service),
  );
  return [...states, ...space.events];
}

/** A row's identity in the store. Only meaningful for `state` rows. */
function idOf(entry: Pick<SpaceStatusEntry, "service" | "key">): string {
  return `${entry.service}:${entry.key}`;
}

export function applySpaceFrame(
  space: SpaceState,
  frame: SpaceFrame,
): SpaceState {
  switch (frame.type) {
    case "space.status":
      return applyStatus(space, frame.entry);

    case "space.status.clear": {
      const states = new Map(space.states);
      let removed = false;
      for (const [id, entry] of space.states) {
        if (entry.service !== frame.service) continue;
        if (frame.key !== undefined && entry.key !== frame.key) continue;
        states.delete(id);
        removed = true;
      }
      // Clearing never bumps the tick — a condition ending is not a reason to
      // put a window back in front of the operator.
      return removed ? { ...space, states } : space;
    }

    case "space.message":
      return { ...space, message: frame.message };

    case "space.replay": {
      // A replay is the tab catching up, not new work: the window must not
      // spring open just because a page was reloaded.
      const states = new Map(space.states);
      for (const entry of frame.entries) states.set(idOf(entry), entry);
      return {
        ...space,
        states,
        ...(frame.message !== undefined ? { message: frame.message } : {}),
      };
    }
  }
}

function applyStatus(
  space: SpaceState,
  entry: SpaceStatusEntry,
): SpaceState {
  if (entry.mode === "event") {
    const events = [...space.events, entry];
    return {
      ...space,
      events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events,
      tick: space.tick + 1,
    };
  }

  const id = idOf(entry);
  const existed = space.states.has(id);
  const states = new Map(space.states);
  states.set(id, entry);
  return { ...space, states, tick: existed ? space.tick : space.tick + 1 };
}

/**
 * Fold a discovery step into the space.
 *
 * Discovery steps are both beats in a paced pass and rows in the window, and
 * they arrive as `DiscoveryEvent`s because the pass owns their pacing and
 * furniture reveals. What they carry now is a space identity: the provider
 * steps claim `providers:auth` and `providers:prompt`, so when a login later
 * reports those keys it revises the rows discovery wrote rather than stacking
 * a contradiction underneath them.
 *
 * Steps are always `state` rows — a step describes how a check came out, and
 * the check can be re-run.
 */
export function applyDiscoveryStep(
  space: SpaceState,
  event: DiscoveryEvent,
): SpaceState {
  switch (event.type) {
    case "discovery.start":
      // A fresh pass re-reports everything it covers; whatever the last one
      // left behind is not part of this run.
      return { ...emptySpace(), tick: space.tick };

    case "discovery.step.start":
      return applyStatus(space, {
        service: event.service ?? "discovery",
        key: event.spaceKey ?? event.id,
        mode: "state",
        label: event.label,
        outcome: "running",
        at: new Date().toISOString(),
      });

    case "discovery.step.done": {
      const id = `${event.service ?? "discovery"}:${event.spaceKey ?? event.id}`;
      const before = space.states.get(id);
      // The label lives on the `start` frame only, so a `done` that arrives
      // without its `start` (a replay edge) still needs something to render.
      const label = before?.label ?? event.id;
      return applyStatus(space, {
        service: event.service ?? "discovery",
        key: event.spaceKey ?? event.id,
        mode: "state",
        label,
        outcome: event.outcome,
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
        at: new Date().toISOString(),
      });
    }

    default:
      return space;
  }
}
