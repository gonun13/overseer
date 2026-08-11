import { useEffect, useReducer, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@overseer/protocol";
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
 * nothing is pretending to work during it. */
const WELCOME_MS = 1100;

export function useDiscovery(): WizardState {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD);
  const socket = useRef<WebSocket | null>(null);
  const phase = state.phase;

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const ws = new WebSocket(url);
    socket.current = ws;

    ws.addEventListener("open", () => dispatch({ type: "socket.open" }));

    ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return; // A frame we can't parse is one we can't act on.
      }

      if (message.type === "connected") return;
      if (message.type === "error") {
        dispatch({ type: "socket.error", message: message.message });
        return;
      }
      dispatch({ type: "server.event", event: message });
    });

    // A socket that closes before discovery finishes leaves the operator
    // watching a step that will never resolve, so say so.
    ws.addEventListener("error", () =>
      dispatch({
        type: "socket.error",
        message: "lost the connection to the server",
      }),
    );

    return () => {
      socket.current = null;
      ws.close();
    };
  }, []);

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
