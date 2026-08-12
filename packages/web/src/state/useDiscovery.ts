import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  ClientMessage,
  DiscoveryEvent,
  PersonalityTone,
  ServerMessage,
} from "@overseer/protocol";
import {
  BOOT_MS,
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

/** How long a typed welcome headline stays up *after typing finishes* before
 * the next beat. Name ask and tone pick wait on the operator, not this timer. */
const WELCOME_MS = 1000;

/** The interval between reveals in the operations window. The server does the
 * real work in milliseconds and emits as it goes, so without this all three
 * steps land in the same frame and the window reads as a list that was always
 * there rather than a pass being run. */
const STEP_MS = 1000;

/** Matches personality.ts MAX_NAME — the wizard input must not offer more than
 * the server will accept. */
const MAX_NAME = 24;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface DiscoveryController extends WizardState {
  /** First-run welcome: send the operator's name to overseer-personality. */
  submitOperatorName: (name: string) => void;
  /** First-run intro: send the chosen tone to overseer-personality. */
  submitOperatorTone: (tone: PersonalityTone) => void;
  /** Persist the active project into internal memory. */
  selectProject: (path: string) => void;
  /** Attach an adapter from the picker (auth is a separate later step). */
  connectAdapter: (id: string) => void;
  /** OverseerSpace calls this when the current headline is fully on screen
   * (typing finished, or shown instantly). Arms the intro/greet holds. */
  onHeadlineReady: (text: string) => void;
}

export function useDiscovery(): DiscoveryController {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD);
  const socket = useRef<WebSocket | null>(null);
  const phase = state.phase;
  const connected = state.connected;
  const welcomeBeat = state.welcomeBeat;
  const phaseRef = useRef(phase);
  const beatRef = useRef(welcomeBeat);
  phaseRef.current = phase;
  beatRef.current = welcomeBeat;

  // Hold timer for intro → name and greet → discovery. Armed by onHeadlineReady
  // once typing has finished, not when the beat flips.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFor = useRef<string | null>(null);

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

  const submitOperatorName = useCallback((raw: string) => {
    const name = raw.trim();
    if (!name || name.length > MAX_NAME) return;
    // Greet immediately — waiting on the write ack made Enter look dead when
    // the server was slow or the frame was refused. Persistence still goes
    // out on the wire below.
    dispatch({ type: "operator.named", name });
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { type: "operator.name", name };
    ws.send(JSON.stringify(message));
  }, []);

  const submitOperatorTone = useCallback((tone: PersonalityTone) => {
    dispatch({ type: "operator.toned", tone });
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { type: "operator.tone", tone };
    ws.send(JSON.stringify(message));
  }, []);

  const selectProject = useCallback((path: string) => {
    dispatch({ type: "project.selected", path });
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { type: "project.select", path };
    ws.send(JSON.stringify(message));
  }, []);

  const connectAdapter = useCallback((id: string) => {
    dispatch({ type: "adapter.connected", id });
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { type: "adapter.connect", id };
    ws.send(JSON.stringify(message));
  }, []);

  /** Start the intro/greet hold once the line is fully on screen. */
  const onHeadlineReady = useCallback((text: string) => {
    if (phaseRef.current !== "welcome") return;
    const beat = beatRef.current;
    if (beat !== "intro" && beat !== "greet") return;
    if (!text || holdFor.current === `${beat}:${text}`) return;
    holdFor.current = `${beat}:${text}`;
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (beat === "intro") dispatch({ type: "intro.done" });
      else dispatch({ type: "welcome.done" });
    }, WELCOME_MS);
  }, []);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    socket.current = ws;

    // Set whenever *we* discard this socket — pagehide or unmount. Closing
    // fires the same error handler a genuine failure would, and a deliberate
    // teardown is not a fault to report.
    let abandoned = false;

    // Do not time out a CONNECTING socket. When Firefox has exhausted its
    // per-host connection slots, `/ws` sits queued (waterfall: issued ~40s
    // late, handshake then ~10ms). Closing and redialling puts a new request
    // at the back of that queue, burns attempts, and ends the wizard with
    // "could not connect" — the failure mode we hit with a 2s redial. One
    // pending socket is what eventually gets the slot; pagehide below is what
    // stops the next reload from inheriting orphans.

    // Identity arrives on the `connected` frame, not on the bare open — the
    // welcome beat needs returning/name before it can choose ask vs greet.
    ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return; // A frame we can't parse is one we can't act on.
      }

      if (message.type === "connected") {
        dispatch({
          type: "socket.open",
          returning: message.returning,
          personality: message.personality ?? {},
          serverTime: message.serverTime,
        });
        return;
      }
      if (message.type === "operator.named") {
        dispatch({ type: "operator.named", name: message.name });
        return;
      }
      if (message.type === "operator.toned") {
        dispatch({ type: "operator.toned", tone: message.tone });
        return;
      }
      if (message.type === "project.selected") {
        dispatch({ type: "project.selected", path: message.path });
        return;
      }
      if (message.type === "adapter.connected") {
        dispatch({ type: "adapter.connected", id: message.id });
        return;
      }
      if (message.type === "workspace.projects") {
        // Not paced: the panel should track the disk, not the discovery queue.
        dispatch({
          type: "workspace.projects",
          projects: message.projects,
          untrackedFolders: message.untrackedFolders,
          activeProjectPath: message.activeProjectPath,
        });
        return;
      }
      if (message.type === "overseer.step") {
        dispatch({
          type: "overseer.step",
          id: message.id,
          label: message.label,
          outcome: message.outcome,
          detail: message.detail,
        });
        return;
      }
      if (message.type === "error") {
        // A refusal the server marked benign is not a lost connection — a
        // rejected name, a `project.select` the server would not persist —
        // so stay put. The flag is the server's answer rather than a list of
        // message types kept in step here, which is how `discovery.run` came
        // to end the wizard on a connection that was fine.
        if (message.benign) return;
        // An error is not paced, and it empties the queue: steps still waiting
        // their turn describe a pass that has already stopped being true.
        stopPacing();
        dispatch({ type: "socket.error", message: message.message });
        return;
      }
      reveal(message);
    });

    // A socket that fails, or that closes before discovery finishes, leaves
    // the operator watching a step that will never resolve — so say so.
    ws.addEventListener("error", () => {
      if (abandoned) return;
      stopPacing();
      dispatch({
        type: "socket.error",
        message: "lost the connection to the server",
      });
    });

    // Reload / navigate without a close frame leaves CONNECTING or ESTABLISHED
    // sockets counted against the per-host limit — the ~40s "connecting" hang
    // on the next load. pagehide is the last reliable chance to free the slot.
    const onPageHide = () => {
      abandoned = true;
      ws.close();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      abandoned = true;
      window.removeEventListener("pagehide", onPageHide);
      socket.current = null;
      ws.close();
      // Under StrictMode this effect runs twice; a pending tick from the first
      // pass would otherwise keep dispatching into the remounted reducer.
      stopPacing();
    };
  }, [reveal, stopPacing]);

  // Minimum boot beat, then stay until the socket is open. Either can finish
  // first; `boot.ready` / `socket.open` each ask the reducer to leave boot
  // only when both gates are true. Connection wait stays on the loading bar
  // so discovery never sits on "connecting".
  useEffect(() => {
    if (phase !== "boot") return;
    const id = setTimeout(() => dispatch({ type: "boot.ready" }), BOOT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Drop a pending hold if we leave an auto-advancing beat.
  useEffect(() => {
    if (phase === "welcome" && (welcomeBeat === "intro" || welcomeBeat === "greet")) {
      return () => {
        if (holdTimer.current !== null) clearTimeout(holdTimer.current);
        holdTimer.current = null;
      };
    }
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdFor.current = null;
  }, [phase, welcomeBeat]);

  // Welcome already required a live socket, so discovery always starts with
  // one. Re-check readyState in case the connection dropped between phases.
  useEffect(() => {
    if (phase !== "discovery" || !connected) return;
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const request: ClientMessage = { type: "discovery.run" };
    ws.send(JSON.stringify(request));
    // Guarded so a re-render mid-pass cannot fire a second request; the server
    // refuses concurrent passes anyway, but this keeps it from having to.
  }, [phase, connected]);

  // Furniture mounts as soon as discovery completes; this hands the headline
  // back to ordinary derivation a beat later so the transition is legible
  // rather than everything changing in the same frame.
  useEffect(() => {
    if (phase !== "settling") return;
    const id = setTimeout(() => dispatch({ type: "settled" }), 600);
    return () => clearTimeout(id);
  }, [phase]);

  return {
    ...state,
    submitOperatorName,
    submitOperatorTone,
    selectProject,
    connectAdapter,
    onHeadlineReady,
  };
}
