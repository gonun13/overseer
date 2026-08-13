import { useCallback, useEffect, useRef } from "react";
import type { DiscoveryEvent } from "@overseer/protocol";

/** The interval between reveals in the operations window. The server does the
 * real work in milliseconds and emits as it goes, so without this all three
 * steps land in the same frame and the window reads as a list that was always
 * there rather than a pass being run. */
const STEP_MS = 1000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Client-side pacing for `DiscoveryEvent` frames. The server is not slowed
 * down; this only staggers what appears in the operations window.
 */
export function useDiscoveryPacing(
  dispatchEvent: (event: DiscoveryEvent) => void,
) {
  const dispatchRef = useRef(dispatchEvent);
  dispatchRef.current = dispatchEvent;

  // Discovery events wait here for their turn on screen. Paced on the client
  // and only on the client: the server is not slowed down, its work still
  // finishes as fast as it can, and the run log records when things actually
  // happened rather than when they were shown.
  const queue = useRef<DiscoveryEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * One tick reveals one line. A step's `done` resolves a line already on
   * screen, so it rides along with the next line's `start` — otherwise a
   * three-step pass would take six ticks and each line would sit at [working]
   * for two seconds.
   *
   * `discovery.complete` gets a tick to itself, which is what keeps the
   * furniture from mounting on top of steps still visibly arriving: it is only
   * applied once it is the last thing left in the queue.
   */
  const drain = useCallback(() => {
    timer.current = null;
    const q = queue.current;
    const head = q[0];
    if (!head) return; // The tick expired with nothing waiting on it.

    let revealed = false;
    if (head.type === "discovery.complete") {
      q.shift();
      dispatchRef.current(head);
      revealed = true;
    } else {
      // Flush the resolutions of lines already on screen, then reveal exactly
      // one new line and stop. `complete` is never taken here — it has to be at
      // the head of a tick to be applied, which is the drained-queue rule.
      while (q.length > 0) {
        const next = q[0]!;
        if (next.type === "discovery.complete") break;
        q.shift();
        dispatchRef.current(next);
        if (next.type === "discovery.step.start") {
          revealed = true;
          break;
        }
      }
    }

    // Re-arm whenever this tick put something on screen, even with nothing left
    // to show: events trickle in one at a time, and without the cooldown each
    // one would find an empty queue and reveal itself the instant it landed —
    // which is the behaviour this whole mechanism exists to stop. A tick that
    // revealed nothing (`discovery.start`, which draws no line) does not start
    // the clock, so the first real step still appears at once.
    if (revealed || q.length > 0) timer.current = setTimeout(drain, STEP_MS);
  }, []);

  /** Reduced motion collapses the pacing entirely — instant, never nothing
   * (design-system.md §9). The steps are information, so they all arrive; they
   * just stop being staged. */
  const reveal = useCallback(
    (event: DiscoveryEvent) => {
      if (prefersReducedMotion()) {
        dispatchRef.current(event);
        return;
      }
      queue.current.push(event);
      // The first event of a pass is not made to wait a tick for nothing: it
      // reveals at once and everything behind it queues up a second apart.
      if (timer.current === null) drain();
    },
    [drain],
  );

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    queue.current = [];
  }, []);

  // Under StrictMode this effect runs twice; a pending tick from the first
  // pass would otherwise keep dispatching into the remounted reducer.
  useEffect(() => () => stop(), [stop]);

  return { reveal, stop };
}
