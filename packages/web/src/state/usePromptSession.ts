import { useCallback, useState } from "react";
import { matchCommand } from "../commands";
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
}

/**
 * Owns focus and slash-command routing for the prompt terminal. A leading `/`
 * dispatches a UI action; anything else is the opening prompt of a new
 * console session in the active project (the caller's business).
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
}: PromptTerminalActions) {
  const [focused, setFocused] = useState(false);

  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);

  /**
   * Returns true when the input was a slash command — matched and dispatched,
   * or unknown and ignored. False means the caller should start a session
   * with it.
   */
  const submit = useCallback(
    (input: string): boolean => {
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
        }
        return true;
      }
      return false;
    },
    [
      closeAllWindows,
          openShell,
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
