import { useCallback, useEffect, useState } from "react";
import type {
  ClientMessage,
  HeldRelay,
  ServerMessage,
} from "@overseer/protocol";

/**
 * Callsign relay as this tab sees it (spec/behaviour/relay.md): sending a
 * relay or a rename, and the agent relays held for the operator. What happens
 * to a relay after it is sent is reported to the overseer space, so this
 * keeps no per-relay state of its own.
 */

let reqSeq = 0;

export function useRelay(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
) {
  const [held, setHeld] = useState<HeldRelay[]>([]);

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === "relay.held") setHeld(message.held);
      }),
    [subscribe],
  );

  const relay = useCallback(
    (to: string, text: string) => {
      send({
        type: "console.relay",
        reqId: `relay-${Date.now().toString(36)}-${++reqSeq}`,
        to,
        text,
      });
    },
    [send],
  );

  const rename = useCallback(
    (from: string, to: string) => send({ type: "callsign.rename", from, to }),
    [send],
  );

  const release = useCallback(
    (id: string, keep: boolean) => {
      // Gone here at once; the server's next list agrees.
      setHeld((current) => current.filter((h) => h.id !== id));
      send({ type: "relay.release", id, release: keep });
    },
    [send],
  );

  const dropAll = useCallback(() => {
    for (const h of held) release(h.id, false);
  }, [held, release]);

  return { held, relay, rename, release, dropAll };
}
