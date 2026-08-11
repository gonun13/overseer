import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  ClientMessage,
  DiscoveryEvent,
  ServerMessage,
} from "@overseer/protocol";
import {
  INITIAL_WIZARD,
  wizardReducer,
  type WizardState,
} from "./wizard";

/**
 * The client half of the discovery pass. Owns the `/ws` connection, feeds every
 * frame into the wizard reducer, and nothing else — the reducer decides what
 * any of it means.
 *
 * Discovery is requested explicitly rather than run on connect (see the
 * `ClientMessage` note in the protocol): the operations window has to be
 * mounted before steps start arriving, and a reconnect must not silently
 * re-run a scan nobody asked for.
 */

/** How long the welcome headline stays up before discovery starts. Long enough
 * to read one short line, and it is a *beat*, not a fake progress delay —
 * nothing is pretending to work during it. Kept short deliberately: the time
 * an operator spends waiting should be spent watching the steps arrive, which
 * is the part that reports something, not watching an empty field first. */
const WELCOME_MS = 1000;

/** The interval between reveals in the operations window. The server does the
 * real work in milliseconds and emits as it goes, so without this all three
 * steps land in the same frame and the window reads as a list that was always
 * there rather than a pass being run. */
const STEP_MS = 1000;

/** When to admit the socket is taking too long. This connection is local —
 * measured at a few milliseconds — so past this it is not slow, it is stuck,
 * and the headline should stop implying ordinary progress. */
const SLOW_MS = 2500;

/**
 * When to give up on a pending socket and dial a fresh one.
 *
 * A connection that has not opened by now generally never will, and leaving it
 * pending is actively harmful: browsers cap concurrent connections per host
 * (Firefox defaults to six), so a socket parked in "connecting" holds a slot
 * that the next attempt — and every other request to this origin — has to wait
 * behind. Dropping it frees the slot, which is the difference between a boot
 * that recovers in seconds and one that appears to hang for a minute.
 */
const CONNECT_TIMEOUT_MS = 6000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useDiscovery(): WizardState {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD);
  const socket = useRef<WebSocket | null>(null);
  const phase = state.phase;
  // Drives the socket effect: bumping it is what dials again, so a redial is
  // an ordinary re-run of the same effect rather than a second code path.
  const attempt = state.attempt;

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
      dispatch({ type: "server.event", event: head });
      revealed = true;
    } else {
      // Flush the resolutions of lines already on screen, then reveal exactly
      // one new line and stop. `complete` is never taken here — it has to be at
      // the head of a tick to be applied, which is the drained-queue rule.
      while (q.length > 0) {
        const next = q[0]!;
        if (next.type === "discovery.complete") break;
        q.shift();
        dispatch({ type: "server.event", event: next });
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
        dispatch({ type: "server.event", event });
        return;
      }
      queue.current.push(event);
      // The first event of a pass is not made to wait a tick for nothing: it
      // reveals at once and everything behind it queues up a second apart.
      if (timer.current === null) drain();
    },
    [drain],
  );

  const stopPacing = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    queue.current = [];
  }, []);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    socket.current = ws;

    // Set whenever *we* discard this socket — redialling it or unmounting.
    // Closing a socket fires its error and close handlers just as a genuine
    // failure would, so without this the redial below reports itself as "lost
    // the connection", ends the boot, and stops the very retry it just began.
    let abandoned = false;

    // Both fire only while the socket is still trying to open; `open` clears
    // them, so neither can interrupt a connection that succeeded.
    const slowTimer = setTimeout(
      () => dispatch({ type: "socket.slow" }),
      SLOW_MS,
    );
    const redialTimer = setTimeout(() => {
      // Closing first is the point, not a formality: it releases the browser
      // connection slot this pending socket is holding. Bumping `attempt` then
      // re-runs this effect with a fresh socket.
      abandoned = true;
      ws.close();
      dispatch({ type: "socket.retry" });
    }, CONNECT_TIMEOUT_MS);

    const settleTimers = () => {
      clearTimeout(slowTimer);
      clearTimeout(redialTimer);
    };

    ws.addEventListener("open", () => {
      settleTimers();
      dispatch({ type: "socket.open" });
    });

    ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return; // A frame we can't parse is one we can't act on.
      }

      if (message.type === "connected") return;
      if (message.type === "error") {
        // An error is not paced, and it empties the queue: steps still waiting
        // their turn describe a pass that has already stopped being true.
        stopPacing();
        dispatch({ type: "socket.error", message: message.message });
        return;
      }
      reveal(message);
    });

    // A socket that closes before discovery finishes leaves the operator
    // watching a step that will never resolve, so say so — unless it never
    // opened in the first place, which is the redial timer's business and not
    // a failure to report yet.
    ws.addEventListener("error", () => {
      if (abandoned) return;
      settleTimers();
      stopPacing();
      dispatch({
        type: "socket.error",
        message: "lost the connection to the server",
      });
    });

    return () => {
      abandoned = true;
      settleTimers();
      socket.current = null;
      ws.close();
      // Under StrictMode this effect runs twice; a pending tick from the first
      // pass would otherwise keep dispatching into the remounted reducer.
      stopPacing();
    };
  }, [attempt, reveal, stopPacing]);

  // The welcome beat, then discovery. Separate effect from the socket so a
  // re-render can never re-open the connection.
  useEffect(() => {
    if (phase !== "welcome") return;
    const id = setTimeout(() => dispatch({ type: "welcome.done" }), WELCOME_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "discovery") return;
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const request: ClientMessage = { type: "discovery.run" };
    ws.send(JSON.stringify(request));
    // Guarded so a re-render mid-pass cannot fire a second request; the server
    // refuses concurrent passes anyway, but this keeps it from having to.
  }, [phase]);

  // Furniture mounts as soon as discovery completes; this hands the headline
  // back to ordinary derivation a beat later so the transition is legible
  // rather than everything changing in the same frame.
  useEffect(() => {
    if (phase !== "settling") return;
    const id = setTimeout(() => dispatch({ type: "settled" }), 600);
    return () => clearTimeout(id);
  }, [phase]);

  return state;
}
