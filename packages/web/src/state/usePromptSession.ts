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
}

/**
 * Owns focus and slash-command routing for the prompt terminal. A leading `/`
 * dispatches a UI action; the caller sends anything else to the active
 * project's session. Model transcripts live on those sessions
 * (useChatSessions), not here.
 */
export function usePromptSession({
  openWindow,
  closeAllWindows,
  openSettings,
  openProjectSelector,
  toggleTheme,
  openLoop,
}: PromptTerminalActions) {
  const [focused, setFocused] = useState(false);

  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);

  /**
   * Returns true when the input was a slash command — matched and dispatched,
   * or unknown and ignored. False means the caller should send it as a session
   * prompt.
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
        }
        return true;
      }
      return false;
    },
    [
      closeAllWindows,
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
