import type {
  ClientMessage,
  ConsoleInfo,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import type { PendingConsole } from "../../state/useConsoles";
import { ConsoleTerminal } from "./ConsoleTerminal";

/**
 * One console: a provider CLI, a shell or a dev-loop run, live on the server.
 *
 * Everything an agent does happens in here, in the CLI's own TUI. Closing the
 * window detaches — the process keeps running and stays in the console list;
 * killing it is a separate, explicit control on the tab.
 */
export function ConsoleWindow({
  info,
  pending,
  theme,
  connected,
  send,
  subscribe,
  onProcessExit,
}: {
  /** The console, once the server has started it. */
  info?: ConsoleInfo;
  /** The request, while it is in flight or after it was refused. */
  pending?: PendingConsole;
  theme: OverseerTheme;
  connected: boolean;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  onProcessExit: (clean: boolean) => void;
}) {
  if (info === undefined) {
    return (
      <div className="console">
        <p className="w-note">
          {pending?.error !== undefined
            ? `could not start: ${pending.error}`
            : pending !== undefined
              ? "starting…"
              : "this console is gone."}
        </p>
      </div>
    );
  }
  return (
    <div className="console">
      <ConsoleTerminal
        consoleId={info.id}
        send={send}
        subscribe={subscribe}
        onProcessExit={onProcessExit}
        theme={theme}
        label={`${info.title} console`}
        connected={connected}
      />
    </div>
  );
}
