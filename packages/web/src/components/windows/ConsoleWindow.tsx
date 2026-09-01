import { WProviderNote } from "./bits";
import type { ProviderInfo } from "../../domain";
import type {
  ClientMessage,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import { ConsoleTerminal } from "./ConsoleTerminal";

/**
 * A direct terminal into the provider's CLI, for operators who already know it.
 * Everything else in Overseer is a considered view of what the agent is doing;
 * this is the escape hatch that admits no view covers everything — you get the
 * raw process, its own slash commands, and its own errors, verbatim.
 *
 * Rendered as a full xterm.js surface matching the window theme
 * (ui-ux-design.md §5.3). Closing the window kills the PTY; the CLI exiting
 * (`/exit`, `/quit`) closes the window.
 */
export function ConsoleWindow({
  provider,
  theme,
  send,
  subscribe,
  onProcessExit,
  mode,
  takeover,
}: {
  provider: ProviderInfo;
  theme: OverseerTheme;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  onProcessExit: () => void;
  /** "loop" opens the dev loop's overseer session instead of the attached
   * provider's bare CLI — it picks its own provider, so the attached one's
   * auth state below is irrelevant to it. */
  mode?: "loop";
  /** End the run currently holding the workspace's lease first. */
  takeover?: boolean;
}) {
  return (
    <div className="console">
      {mode !== "loop" && !provider.authenticated && (
        <WProviderNote provider={provider} />
      )}
      <ConsoleTerminal
        send={send}
        subscribe={subscribe}
        onProcessExit={onProcessExit}
        authenticated={provider.authenticated}
        theme={theme}
        mode={mode}
        takeover={takeover}
      />
    </div>
  );
}
