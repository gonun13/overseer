import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  ClientMessage,
  DiscoveryEvent,
  OverseerTheme,
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
  /** Create a new project: mkdir under the workspace root, `git init`, write
   * a README. The result lands in `projectCreate`; the new project itself
   * follows via the ordinary `workspace.projects` broadcast. */
  createProject: (input: {
    name: string;
    folder: string;
    description: string;
  }) => void;
  /** Persist the theme into internal memory. */
  selectTheme: (theme: OverseerTheme) => void;
  /** Attach a provider from the picker (auth is a separate later step). */
  connectProvider: (id: string) => void;
  /** Start (or join) the provider's login. The URL comes back over the socket. */
  startLogin: (providerId: string) => void;
  /** Relay the operator's paste. Sent exactly as typed — see `ProvidersWindow`. */
  submitAuthCode: (code: string) => void;
  /** Abandon the login in flight. */
  cancelLogin: () => void;
  /** `claude auth logout` on the container's CLI. */
  signOut: (providerId: string) => void;
  /** Put the reset decision up. Nothing is erased and nothing is sent. */
  askReset: () => void;
  /** Answer the decision with no. */
  declineReset: () => void;
  /** Answer the decision with yes — the wipe starts on the server. */
  confirmReset: () => void;
  /** OverseerSpace calls this when the current headline is fully on screen
   * (typing finished, or shown instantly). Arms the intro/greet holds. */
  onHeadlineReady: (text: string) => void;
  /** Send a frame on the shared `/ws` socket. */
  send: (message: ClientMessage) => void;
  /** Subscribe to console.* (and console-related error) frames. */
  subscribeConsole: (
    listener: (message: ServerMessage) => void,
  ) => () => void;
  /** Subscribe to session.*, provider.options, and their error frames. */
  subscribeSession: (
    listener: (message: ServerMessage) => void,
  ) => () => void;
  /** Subscribe to loop.config and its error frames. */
  subscribeLoop: (
    listener: (message: ServerMessage) => void,
  ) => () => void;
}

export function useDiscovery(): DiscoveryController {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD);
  const { phase, connected } = state;
  const consoleListeners = useRef(
    new Set<(message: ServerMessage) => void>(),
  );
  const sessionListeners = useRef(
    new Set<(message: ServerMessage) => void>(),
  );
  const loopListeners = useRef(
    new Set<(message: ServerMessage) => void>(),
  );

  const dispatchEvent = useCallback(
    (event: DiscoveryEvent) => dispatch({ type: "server.event", event }),
    [],
  );

  const { reveal, stop: stopPacing } = useDiscoveryPacing(dispatchEvent);

  const handleServerMessage = useCallback(
    (message: ServerMessage) => {
      if (
        message.type === "console.opened" ||
        message.type === "console.output" ||
        message.type === "console.exit" ||
        (message.type === "error" && message.about?.startsWith("console."))
      ) {
        for (const listener of consoleListeners.current) listener(message);
        // Console errors are benign refusals (not signed in, stale id) — they
        // must not tear the wizard down the way a lost socket would.
        return;
      }
      if (
        message.type === "session.list" ||
        message.type === "session.history" ||
        message.type === "session.event" ||
        message.type === "session.meta" ||
        // Plans are read out of the same transcripts the sessions above come
        // from, and every plan operation is an operation on a session — same
        // channel, same benign refusals.
        message.type === "plan.list" ||
        message.type === "plan.implementing" ||
        // What the provider offers a session is a session-control concern, and
        // its refusals are benign the same way the console's are. A manual
        // usage check is the same kind of ask — on-demand, provider-scoped,
        // a refusal that must not tear the wizard down.
        message.type === "provider.options" ||
        message.type === "provider.usageCheck" ||
        // The project management window's own requests — single-window,
        // project-scoped, and their refusals (nothing to commit, no remote,
        // a merge conflict) are exactly the same kind of benign "stay put"
        // as the rest of this channel.
        // The capabilities window's subagent inventory — provider- and
        // project-scoped, and its refusals ("no active project", a name that
        // is not kebab-case) are benign in exactly the same way.
        message.type === "subagent.list" ||
        message.type === "subagent.written" ||
        message.type === "subagent.deleted" ||
        message.type === "project.git.status" ||
        message.type === "project.git.committed" ||
        message.type === "project.git.pushed" ||
        message.type === "project.git.merged" ||
        message.type === "project.git.reverted" ||
        (message.type === "error" && message.about?.startsWith("session.")) ||
        (message.type === "error" && message.about?.startsWith("plan.")) ||
        (message.type === "error" && message.about === "provider.options") ||
        (message.type === "error" && message.about === "provider.checkUsage") ||
(message.type === "error" && message.about?.startsWith("project.git.")) ||
        (message.type === "error" && message.about?.startsWith("subagent."))
      ) {
        for (const listener of sessionListeners.current) listener(message);
        return;
      }
      if (
        message.type === "loop.config" ||
        message.type === "loop.models" ||
        (message.type === "error" && message.about?.startsWith("loop."))
      ) {
        // The loop's own config, independent of the app's attached provider —
        // its refusals are benign the same way console/session ones are, and
        // must reach the loop tab rather than fall into the generic benign-
        // error return below, which would just drop them silently.
        for (const listener of loopListeners.current) listener(message);
        return;
      }
      if (message.type === "connected") {
        dispatch({
          type: "socket.open",
          returning: message.returning,
          personality: message.personality ?? {},
          serverTime: message.serverTime,
          theme: message.theme,
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
      if (message.type === "project.created") {
        dispatch({ type: "project.created" });
        return;
      }
      if (message.type === "error" && message.about === "project.create") {
        // Routed ahead of the generic error branch below: that one only
        // sets `state.error` for a non-benign failure, which would leave
        // the create-project form's own `projectCreate` status stuck on
        // "working" forever instead of showing the refusal inline.
        dispatch({ type: "project.create.failed", message: message.message });
        return;
      }
      if (message.type === "theme.selected") {
        dispatch({ type: "theme.selected", theme: message.theme });
        return;
      }
      if (message.type === "provider.connected") {
        dispatch({ type: "provider.connected", id: message.id });
        return;
      }
      if (message.type === "provider.status") {
        dispatch({
          type: "provider.status",
          id: message.id,
          status: message.status,
        });
        return;
      }
      if (message.type === "auth.state") {
        dispatch({
          type: "auth.state",
          state: {
            providerId: message.providerId,
            phase: message.phase,
            verificationUrl: message.verificationUrl,
            detail: message.detail,
            retryable: message.retryable,
            status: message.status,
          },
        });
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
      if (message.type === "memory.reset.done") {
        dispatch({ type: "reset.done" });
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

  const { onHeadlineReady: onTimingReady } = useWizardTiming(
    state,
    dispatch,
    () => {
      location.reload();
    },
  );

  // Clear a one-shot forced type (the headline after a refused reset) once it
  // has landed — otherwise every later change would keep typing.
  const onHeadlineReady = useCallback(
    (text: string) => {
      onTimingReady(text);
      dispatch({ type: "headline.typed" });
    },
    [onTimingReady],
  );

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

  const createProject = useCallback(
    (input: { name: string; folder: string; description: string }) => {
      dispatch({ type: "project.create.requested" });
      const message: ClientMessage = { type: "project.create", ...input };
      send(message);
    },
    [send],
  );

  const selectTheme = useCallback(
    (theme: OverseerTheme) => {
      dispatch({ type: "theme.selected", theme });
      const message: ClientMessage = { type: "theme.select", theme };
      send(message);
    },
    [send],
  );

  const connectProvider = useCallback(
    (id: string) => {
      dispatch({ type: "provider.connected", id });
      const message: ClientMessage = { type: "provider.connect", id };
      send(message);
    },
    [send],
  );

  const startLogin = useCallback(
    (providerId: string) => {
      // Show `starting` on the click rather than on the first server frame.
      // The URL lands ~400ms after the CLI spawns, and a surface that stays
      // blank until then reads as a button that did nothing.
      dispatch({ type: "auth.requested", providerId });
      const message: ClientMessage = { type: "auth.start", providerId };
      send(message);
    },
    [send],
  );

  const submitAuthCode = useCallback(
    (code: string) => {
      // Nothing is done to `code` here, and nothing may be. It is
      // `<code>#<state>`, the `#` is not a URL fragment, and stripping it is a
      // login that fails while telling the operator they copied it wrong.
      const message: ClientMessage = { type: "auth.code", code };
      send(message);
    },
    [send],
  );

  const cancelLogin = useCallback(() => {
    const message: ClientMessage = { type: "auth.cancel" };
    send(message);
  }, [send]);

  const signOut = useCallback(
    (providerId: string) => {
      const message: ClientMessage = { type: "auth.signout", providerId };
      send(message);
    },
    [send],
  );

  const askReset = useCallback(() => dispatch({ type: "reset.asked" }), []);

  const declineReset = useCallback(
    () => dispatch({ type: "reset.declined" }),
    [],
  );

  const confirmReset = useCallback(() => {
    dispatch({ type: "reset.confirmed" });
    const message: ClientMessage = { type: "memory.reset" };
    send(message);
  }, [send]);

  const subscribeConsole = useCallback(
    (listener: (message: ServerMessage) => void) => {
      consoleListeners.current.add(listener);
      return () => {
        consoleListeners.current.delete(listener);
      };
    },
    [],
  );

  const subscribeSession = useCallback(
    (listener: (message: ServerMessage) => void) => {
      sessionListeners.current.add(listener);
      return () => {
        sessionListeners.current.delete(listener);
      };
    },
    [],
  );

  const subscribeLoop = useCallback(
    (listener: (message: ServerMessage) => void) => {
      loopListeners.current.add(listener);
      return () => {
        loopListeners.current.delete(listener);
      };
    },
    [],
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

  // Memoized because consumers key their own memos and effects off this object
  // (useShellPresentation derives projects and signals from it). Returning a
  // fresh literal every render defeated every one of those memos and drove a
  // self-sustaining render loop through App's retitle effect.
  return useMemo(
    () => ({
      ...state,
      submitOperatorName,
      submitOperatorTone,
      selectProject,
      createProject,
      selectTheme,
      connectProvider,
      startLogin,
      submitAuthCode,
      cancelLogin,
      signOut,
      askReset,
      declineReset,
      confirmReset,
      onHeadlineReady,
      send,
      subscribeConsole,
      subscribeSession,
      subscribeLoop,
    }),
    [
      state,
      submitOperatorName,
      submitOperatorTone,
      selectProject,
      createProject,
      selectTheme,
      connectProvider,
      startLogin,
      submitAuthCode,
      cancelLogin,
      signOut,
      askReset,
      declineReset,
      confirmReset,
      onHeadlineReady,
      send,
      subscribeConsole,
      subscribeSession,
      subscribeLoop,
    ],
  );
}
