import { useCallback, useEffect, useReducer } from "react";
import type {
  ClientMessage,
  DiscoveryEvent,
  PersonalityTone,
  ServerMessage,
} from "@overseer/protocol";
import { useDiscoveryPacing } from "./useDiscoveryPacing";
import { useOverseerSocket } from "./useOverseerSocket";
import { useWizardTiming } from "./useWizardTiming";
import {
  INITIAL_WIZARD,
  wizardReducer,
  type WizardState,
} from "./wizard";

/**
 * The client half of the discovery pass. Composes transport, pacing, and
 * phase timers around the wizard reducer — the reducer decides what any of
 * it means.
 *
 * Discovery is requested explicitly rather than run on connect (see the
 * `ClientMessage` note in the protocol): the operations window has to be
 * mounted before steps start arriving, and a reconnect must not silently
 * re-run a scan nobody asked for.
 */

/** Matches personality.ts MAX_NAME — the wizard input must not offer more than
 * the server will accept. */
const MAX_NAME = 24;

function isDiscoveryEvent(message: ServerMessage): message is DiscoveryEvent {
  return message.type.startsWith("discovery.");
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
  const { phase, connected } = state;

  const dispatchEvent = useCallback(
    (event: DiscoveryEvent) => dispatch({ type: "server.event", event }),
    [],
  );

  const { reveal, stop: stopPacing } = useDiscoveryPacing(dispatchEvent);

  const handleServerMessage = useCallback(
    (message: ServerMessage) => {
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
          personality: message.personality,
          rejected: message.rejected,
          personalityMissing: message.personalityMissing,
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
      if (isDiscoveryEvent(message)) {
        reveal(message);
      }
    },
    [reveal, stopPacing],
  );

  const handleConnectionLost = useCallback(
    (message: string) => {
      stopPacing();
      dispatch({ type: "socket.error", message });
    },
    [stopPacing],
  );

  const { send } = useOverseerSocket({
    onMessage: handleServerMessage,
    onConnectionLost: handleConnectionLost,
  });

  const { onHeadlineReady } = useWizardTiming(state, dispatch);

  const submitOperatorName = useCallback(
    (raw: string) => {
      const name = raw.trim();
      if (!name || name.length > MAX_NAME) return;
      // Greet immediately — waiting on the write ack made Enter look dead when
      // the server was slow or the frame was refused. Persistence still goes
      // out on the wire below.
      dispatch({ type: "operator.named", name });
      const message: ClientMessage = { type: "operator.name", name };
      send(message);
    },
    [send],
  );

  const submitOperatorTone = useCallback(
    (tone: PersonalityTone) => {
      dispatch({ type: "operator.toned", tone });
      const message: ClientMessage = { type: "operator.tone", tone };
      send(message);
    },
    [send],
  );

  const selectProject = useCallback(
    (path: string) => {
      dispatch({ type: "project.selected", path });
      const message: ClientMessage = { type: "project.select", path };
      send(message);
    },
    [send],
  );

  const connectAdapter = useCallback(
    (id: string) => {
      dispatch({ type: "adapter.connected", id });
      const message: ClientMessage = { type: "adapter.connect", id };
      send(message);
    },
    [send],
  );

  // Welcome already required a live socket, so discovery always starts with
  // one — and only after name, tone and the greet presentation have finished.
  // Re-check readyState in case the connection dropped between phases.
  useEffect(() => {
    if (phase !== "discovery" || !connected) return;
    const request: ClientMessage = { type: "discovery.run" };
    send(request);
    // Guarded so a re-render mid-pass cannot fire a second request; the server
    // refuses concurrent passes anyway, but this keeps it from having to.
  }, [phase, connected, send]);

  return {
    ...state,
    submitOperatorName,
    submitOperatorTone,
    selectProject,
    connectAdapter,
    onHeadlineReady,
  };
}
