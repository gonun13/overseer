import { useCallback, useState } from "react";
import { addressInput, commandArgs, matchCommand } from "../commands";
import type { WindowKind } from "../windows";

type OpenWindow = (
  kind: WindowKind,
  payload?: unknown,
  title?: string,
) => void;

interface PromptTerminalActions {
  openWindow: OpenWindow;
  closeAllWindows: () => void;
  openSettings: () => void;
  openProjectSelector: () => void;
  toggleTheme: () => void;
  openLoop: () => void;
  openShell: () => void;
  tileWindows: () => void;
  /** Relay text to an agent by callsign (spec/behaviour/relay.md §2). */
  relayTo: (callsign: string, text: string) => void;
  /** Bring an agent's console up, resuming it if dormant. */
  showAgent: (callsign: string) => void;
  renameAgent: (from: string, to: string) => void;
  dropRelays: () => void;
}

/**
 * Owns focus and routing for the prompt terminal. A leading `/` dispatches a
 * UI action; a leading `@` addresses an agent; anything else is the opening
 * prompt of a new console session in the active project (the caller's
 * business).
 */
export function usePromptSession({
  openWindow,
  closeAllWindows,
  openSettings,
  openProjectSelector,
  toggleTheme,
  openLoop,
  openShell,
  tileWindows,
  relayTo,
  showAgent,
  renameAgent,
  dropRelays,
}: PromptTerminalActions) {
  const [focused, setFocused] = useState(false);

  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);

  /**
   * Returns true when the input was a slash command or addressed to an agent —
   * dispatched, or malformed and ignored. False means the caller should start
   * a session with it.
   */
  const submit = useCallback(
    (input: string): boolean => {
      const addressed = addressInput(input);
      if (addressed !== undefined) {
        if (addressed.to === "") return true;
        if (addressed.text === "") showAgent(addressed.to);
        else relayTo(addressed.to, addressed.text);
        return true;
      }
      if (slashInput(input)) {
        const command = matchCommand(input);
        if (!command) return true;
        switch (command.action.type) {
          case "open":
            openWindow(command.action.kind);
            return true;
          case "settings":
            openSettings();
            return true;
          case "selector":
            openProjectSelector();
            return true;
          case "theme":
            toggleTheme();
            return true;
          case "close-all":
            closeAllWindows();
            return true;
          case "loop":
            openLoop();
            return true;
          case "shell":
            openShell();
            return true;
          case "tile":
            tileWindows();
            return true;
          case "rename": {
            const [from, to] = commandArgs(input);
            if (from !== undefined && to !== undefined) renameAgent(from, to);
            return true;
          }
          case "drop-relays":
            dropRelays();
            return true;
        }
        return true;
      }
      return false;
    },
    [
      closeAllWindows,
      dropRelays,
      openShell,
      relayTo,
      renameAgent,
      showAgent,
      tileWindows,
      openLoop,
      openProjectSelector,
      openSettings,
      openWindow,
      toggleTheme,
    ],
  );

  return {
    focused,
    focus,
    blur,
    submit,
  };
}

function slashInput(input: string): boolean {
  return input.trim().startsWith("/");
}
