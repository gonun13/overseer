import { useCallback, useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import type {
  ClientMessage,
  OverseerTheme,
  ServerMessage,
} from "@overseer/protocol";
import "@xterm/xterm/css/xterm.css";

/**
 * Mounts an xterm.js terminal on one of the server's consoles.
 *
 * The console outlives this terminal: mounting attaches (scrollback replay,
 * then live output), unmounting only detaches. Overseer forwards keystrokes
 * and output verbatim — slash commands, cursor control and `/exit` are the
 * CLI's business.
 */

export interface ConsoleTerminalProps {
  consoleId: string;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  /** The process exited; `clean` is a zero exit (the operator's own `/exit`). */
  onProcessExit: (clean: boolean) => void;
  /** Matches the Overseer surface: dark samaritan, light machine. */
  theme: OverseerTheme;
  /** Accessible name — which console this is. */
  label: string;
  /** Socket state. A reconnect is a new socket the server has never attached,
   * so the terminal attaches again (and replays) when this flips back on. */
  connected: boolean;
}

function xtermTheme(theme: OverseerTheme): ITheme {
  if (theme === "machine") {
    return {
      background: "#eeeeee",
      foreground: "#0d0d0d",
      cursor: "#0d0d0d",
      cursorAccent: "#eeeeee",
      selectionBackground: "rgba(13, 13, 13, 0.2)",
      black: "#0d0d0d",
      red: "#c0201c",
      green: "#1a8a4c",
      yellow: "#8a6100",
      blue: "#1a5bb8",
      magenta: "#7a3e9d",
      cyan: "#2a7a82",
      white: "#eeeeee",
      brightBlack: "#5c5c5c",
      brightRed: "#c0201c",
      brightGreen: "#1a8a4c",
      brightYellow: "#8a6100",
      brightBlue: "#1a5bb8",
      brightMagenta: "#7a3e9d",
      brightCyan: "#2a7a82",
      brightWhite: "#0d0d0d",
    };
  }
  return {
    background: "#0a0a0a",
    foreground: "#f3f3f3",
    cursor: "#f3f3f3",
    cursorAccent: "#0a0a0a",
    selectionBackground: "rgba(243, 243, 243, 0.25)",
    black: "#0a0a0a",
    red: "#ff4a44",
    green: "#35d67f",
    yellow: "#f1c40f",
    blue: "#4a90f0",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#f3f3f3",
    brightBlack: "#5c5c5c",
    brightRed: "#ff4a44",
    brightGreen: "#35d67f",
    brightYellow: "#f1c40f",
    brightBlue: "#4a90f0",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  };
}

export function ConsoleTerminal({
  consoleId,
  send,
  subscribe,
  onProcessExit,
  theme,
  label,
  connected,
}: ConsoleTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** Output that arrives before our replay is already inside it. */
  const replayed = useRef(false);
  const onProcessExitRef = useRef(onProcessExit);
  onProcessExitRef.current = onProcessExit;
  const sendRef = useRef(send);
  sendRef.current = send;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const fit = useCallback(() => {
    const addon = fitRef.current;
    const term = termRef.current;
    if (!addon || !term) return;
    try {
      addon.fit();
    } catch {
      // Host not laid out yet.
      return;
    }
    if (!replayed.current) return;
    sendRef.current({
      type: "console.resize",
      id: consoleId,
      cols: term.cols,
      rows: term.rows,
    });
  }, [consoleId]);

  const wasConnected = useRef(connected);
  useEffect(() => {
    const reconnected = connected && !wasConnected.current;
    wasConnected.current = connected;
    const term = termRef.current;
    if (!reconnected || !term) return;
    replayed.current = false;
    sendRef.current({
      type: "console.attach",
      id: consoleId,
      cols: term.cols,
      rows: term.rows,
    });
  }, [connected, consoleId]);

  // Only the xterm chrome follows a theme flip; the console keeps running.
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = xtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: xtermTheme(themeRef.current),
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    termRef.current = term;
    fitRef.current = fitAddon;
    replayed.current = false;

    const unsubscribe = subscribe((message) => {
      if (!("id" in message) || message.id !== consoleId) return;
      if (message.type === "console.replay") {
        term.reset();
        term.write(message.data);
        replayed.current = true;
        term.focus();
        return;
      }
      if (message.type === "console.output") {
        if (replayed.current) term.write(message.data);
        return;
      }
      if (message.type === "console.exit") {
        const signal =
          message.signal !== undefined ? ` · signal ${message.signal}` : "";
        term.writeln(
          `\r\n[process exited with code ${message.exitCode}${signal}]`,
        );
        onProcessExitRef.current(message.exitCode === 0);
      }
    });

    // Defer the attach until the window body's expand animation has given
    // the host a real size — otherwise cols/rows collapse to 1 and the TUI
    // redraws for a one-column terminal.
    const attachTimer = window.setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        // Attach at whatever size xterm has.
      }
      sendRef.current({
        type: "console.attach",
        id: consoleId,
        cols: term.cols,
        rows: term.rows,
      });
    }, 320);

    // A macOS dead key (~ ´ ^ on Portuguese, Spanish, French layouts) opens a
    // one-key composition. Firefox reports the key that completes it with its
    // real keyCode rather than 229, and xterm reads that as "composition
    // over": it sends the bare accent, then the composed letter (são → s~ão).
    // Leave printable keys to the composition, which delivers the letter.
    term.attachCustomKeyEventHandler(
      (event) =>
        !(
          event.type === "keydown" &&
          event.isComposing &&
          event.keyCode !== 229 &&
          event.key.length === 1
        ),
    );

    const dataDisposable = term.onData((data) => {
      sendRef.current({ type: "console.input", id: consoleId, data });
    });

    const observer = new ResizeObserver(() => fit());
    observer.observe(host);

    return () => {
      window.clearTimeout(attachTimer);
      observer.disconnect();
      dataDisposable.dispose();
      unsubscribe();
      // Detach only: closing a window is not ending the process.
      sendRef.current({ type: "console.detach", id: consoleId });
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [consoleId, fit, subscribe]);

  return (
    <div
      className="console-term no-drag"
      ref={hostRef}
      onClick={() => termRef.current?.focus()}
      role="application"
      aria-label={label}
    />
  );
}
