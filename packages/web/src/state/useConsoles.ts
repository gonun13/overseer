import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ConsoleInfo,
  ConsoleKind,
  ServerMessage,
} from "@overseer/protocol";
export { consoleLight } from "./console-light.ts";

/**
 * Every console the server runs, as this tab sees it. Consoles belong to the
 * server: the list arrives on connect and on every change, from any tab, so
 * this is a mirror and never the source of truth.
 */

export interface ConsoleOpenRequest {
  kind: ConsoleKind;
  projectPath: string;
  providerId?: string;
  sessionId?: string;
  resume?: boolean;
  prompt?: string;
  takeover?: boolean;
}

/** A request in flight, or one the server refused — its window shows which. */
export interface PendingConsole {
  reqId: string;
  request: ConsoleOpenRequest;
  error?: string;
}

/** The size a console starts at before its window has measured itself; the
 * window attaches with its real size a moment later and the PTY follows. */
const INITIAL_COLS = 120;
const INITIAL_ROWS = 32;

let reqSeq = 0;

export function useConsoles(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  /** Called once per successful open — the caller puts up a window. */
  onOpened: (reqId: string, info: ConsoleInfo) => void,
) {
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);
  /** False until the first list of this connection — restoring a layout
   * against an empty list would forget every window. */
  const [listed, setListed] = useState(false);
  const [pending, setPending] = useState<PendingConsole[]>([]);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === "console.list") {
          setConsoles(message.consoles);
          setListed(true);
          return;
        }
        if (message.type === "console.state") {
          setConsoles((current) =>
            current.map((c) =>
              c.id === message.id ? { ...c, activity: message.activity } : c,
            ),
          );
          return;
        }
        if (message.type === "console.opened") {
          setPending((current) => current.filter((p) => p.reqId !== message.reqId));
          setConsoles((current) =>
            current.some((c) => c.id === message.console.id)
              ? current
              : [...current, message.console],
          );
          onOpenedRef.current(message.reqId, message.console);
          return;
        }
        if (message.type === "console.failed") {
          setPending((current) =>
            current.map((p) =>
              p.reqId === message.reqId ? { ...p, error: message.reason } : p,
            ),
          );
        }
      }),
    [subscribe],
  );

  /** Ask for a console. Returns the request id its window is keyed on until
   * the server answers. */
  const open = useCallback(
    (request: ConsoleOpenRequest): string => {
      const reqId = `req-${Date.now().toString(36)}-${++reqSeq}`;
      setPending((current) => [...current, { reqId, request }]);
      send({
        type: "console.open",
        reqId,
        ...request,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
      });
      return reqId;
    },
    [send],
  );

  const forgetPending = useCallback((reqId: string) => {
    setPending((current) => current.filter((p) => p.reqId !== reqId));
  }, []);

  /** Forget a console: the server ends it if it is still running and drops
   * it from the list. Removed here at once rather than on the server's next
   * list, so its row and window go the moment the operator asks. This is
   * also what kill is — an operator's kill is deliberate, so it is never an
   * exit to report or a row to dismiss afterwards. */
  const dismiss = useCallback(
    (id: string) => {
      setConsoles((current) => current.filter((c) => c.id !== id));
      send({ type: "console.dismiss", id });
    },
    [send],
  );

  return { consoles, listed, pending, open, forgetPending, dismiss };
}
