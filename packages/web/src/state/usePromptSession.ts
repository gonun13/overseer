import { useCallback, useState } from "react";
import { matchCommand } from "../commands";
import type { Turn } from "../domain";
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
}

/**
 * Owns the state and command routing for the prompt terminal — the shell's own
 * input. Slash commands dispatch UI actions; anything else is addressed to the
 * overseer itself. Model conversations are not here: each has its own session
 * window (useChatSessions) — no session option state lives here.
 */
export function usePromptSession({
  openWindow,
  closeAllWindows,
  openSettings,
  openProjectSelector,
  toggleTheme,
}: PromptTerminalActions) {
  const [focused, setFocused] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  const resetTurns = useCallback(() => setTurns([]), []);

  const submit = useCallback(
    (input: string) => {
      const command = matchCommand(input);
      if (command) {
        switch (command.action.type) {
          case "open":
            openWindow(command.action.kind);
            return;
          case "settings":
            openSettings();
            return;
          case "selector":
            openProjectSelector();
            return;
          case "theme":
            toggleTheme();
            return;
          case "close-all":
            closeAllWindows();
            return;
        }
      }

      setTurns((current) => [
        ...current,
        { id: `u${current.length}`, kind: "user", text: input },
      ]);
      setBusy(true);
      // Placeholder for the real stream; replaced when the WS event pipe lands.
      setTimeout(() => {
        setBusy(false);
      }, 1200);
    },
    [
      closeAllWindows,
      openProjectSelector,
      openSettings,
      openWindow,
      toggleTheme,
    ],
  );

  const inspectTurn = useCallback(
    (id: string) => {
      const turn = turns.find((candidate) => candidate.id === id);
      if (turn?.kind === "tool") {
        openWindow("diff", turn.target, turn.tool);
      }
    },
    [openWindow, turns],
  );

  return {
    focused,
    turns,
    busy,
    focus,
    blur,
    resetTurns,
    submit,
    inspectTurn,
  };
}
