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
 * Mounts an xterm.js terminal against the server's raw Claude PTY console.
 *
 * Overseer forwards keystrokes and output verbatim — slash commands, cursor
 * control, and `/exit` / `/quit` are the CLI's business. When the process
 * exits, `onProcessExit` closes the Overseer window.
 */

export interface ConsoleTerminalProps {
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  onProcessExit: () => void;
  /** True when the provider is signed in — otherwise the open is refused.
   * Ignored when `mode === "loop"`: the loop picks its own provider. */
  authenticated: boolean;
  /** Matches the Overseer surface: dark samaritan, light machine. */
  theme: OverseerTheme;
  /** "loop" opens `loop/run` for the active project instead of the bare
   * provider CLI. */
  mode?: "loop";
  /** End the run holding this workspace's lease first. Set only after the
   * operator answered the take-over decision. */
  takeover?: boolean;
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
  send,
  subscribe,
  onProcessExit,
  authenticated,
  theme,
  mode,
  takeover,
}: ConsoleTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const consoleId = useRef<string | null>(null);
  const opened = useRef(false);
  const closing = useRef(false);
  const onProcessExitRef = useRef(onProcessExit);
  onProcessExitRef.current = onProcessExit;
  const sendRef = useRef(send);
  sendRef.current = send;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Read once, at mount: a take-over applies to the run this terminal is
  // starting, never to a later re-render of the same one.
  const takeoverRef = useRef(takeover);

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
    const id = consoleId.current;
    if (id === null) return;
    sendRef.current({
      type: "console.resize",
      id,
      cols: term.cols,
      rows: term.rows,
    });
  }, []);

  // Rebuild the terminal when the Overseer theme flips so colours stay in step
  // with the window surface. Closing/reopening the PTY on theme change would
  // kill the CLI mid-turn — only the xterm chrome is swapped; the socket keeps
  // the same console id and stream.
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
      theme: xtermTheme(themeRef.current),
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    termRef.current = term;
    fitRef.current = fitAddon;

    // Defer fit until the window body's expand animation has given the host
    // a real size — otherwise cols/rows collapse to 1.
    const openTimer = window.setTimeout(() => {
      fitAddon.fit();
      // The loop picks its own provider (loop/.provider / LOOP_PROVIDER),
      // independently of whatever Overseer itself has attached — so it opens
      // regardless of the attached provider's auth state.
      if (modeRef.current !== "loop" && !authenticated) {
        term.writeln("provider is not signed in");
        return;
      }
      sendRef.current({
        type: "console.open",
        cols: term.cols,
        rows: term.rows,
        ...(modeRef.current ? { mode: modeRef.current } : {}),
        ...(takeoverRef.current === true ? { takeover: true } : {}),
      });
      opened.current = true;
      term.focus();
    }, 320);

    const dataDisposable = term.onData((data) => {
      const id = consoleId.current;
      if (id === null) return;
      sendRef.current({ type: "console.input", id, data });
    });

    const unsubscribe = subscribe((message) => {
      if (message.type === "console.opened") {
        // The socket can hold a raw CLI console and a loop console at once,
        // and both terminals see every frame. Adopt only the ack for our own
        // slot, or the two windows steal each other's streams.
        if ((message.mode ?? undefined) !== modeRef.current) return;
        consoleId.current = message.id;
        // Size may have changed between open request and ack.
        fit();
        term.focus();
        return;
      }
      if (message.type === "console.output") {
        if (message.id !== consoleId.current) return;
        term.write(message.data);
        return;
      }
      if (message.type === "console.exit") {
        if (message.id !== consoleId.current) return;
        consoleId.current = null;
        closing.current = true;
        // A clean exit is the operator's own `/exit` or `/quit`, so the window
        // goes with it. A failure is the opposite: it is the only account of
        // what went wrong, and a process that dies on startup (a loop refusing
        // a held lease, a missing binary) used to take the window with it
        // before anything could be read.
        if (message.exitCode === 0) {
          onProcessExitRef.current();
          return;
        }
        const signal =
          message.signal !== undefined ? ` · signal ${message.signal}` : "";
        term.writeln(
          `\r\n[process exited with code ${message.exitCode}${signal}]`,
        );
        return;
      }
      if (message.type === "error" && message.about?.startsWith("console.")) {
        const loopError = message.about.endsWith(".loop");
        if (loopError !== (modeRef.current === "loop")) return;
        term.writeln(`\r\n${message.message}`);
      }
    });

    const observer = new ResizeObserver(() => fit());
    observer.observe(host);

    return () => {
      window.clearTimeout(openTimer);
      observer.disconnect();
      dataDisposable.dispose();
      unsubscribe();
      const id = consoleId.current;
      consoleId.current = null;
      if (id !== null && !closing.current) {
        sendRef.current({ type: "console.close", id });
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [authenticated, fit, subscribe]);

  return (
    <div
      className="console-term no-drag"
      ref={hostRef}
      onClick={() => termRef.current?.focus()}
      role="application"
      aria-label="provider console"
    />
  );
}
