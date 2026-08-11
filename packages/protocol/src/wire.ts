import type { DiscoveryEvent } from "./discovery.js";

/**
 * The `/ws` envelope. Discovery is the first traffic to go over this socket,
 * but it will not be the last — the session supervisor (webui design doc §1.2)
 * routes over the same connection. So the envelope is a plain `type`-tagged
 * union with no discovery-specific framing: new families join by adding
 * variants, not by wrapping.
 */

export type ClientMessage =
  /** Ask the server to run a discovery pass. Explicit rather than
   * connect-time-automatic: a reconnect must not silently re-run a scan the
   * operator did not ask for, and the client needs the operations window
   * mounted before steps start arriving. */
  { type: "discovery.run" };

export interface ConnectedMessage {
  type: "connected";
  /** Server's clock at connect. The client renders time; the server owns it. */
  serverTime: string;
}

export interface ErrorMessage {
  type: "error";
  /** Echoes the client message `type` that failed, when there was one. */
  about?: string;
  message: string;
}

export type ServerMessage = ConnectedMessage | ErrorMessage | DiscoveryEvent;

/** Narrows an unknown parsed frame to a client message. The socket is a trust
 * boundary even on loopback — nothing downstream should be casting. */
export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "discovery.run"
  );
}
