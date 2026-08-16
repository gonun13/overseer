import { useCallback, useState } from "react";
import { matchCommand } from "../commands";
import type { Turn } from "../domain";
import type { WindowKind } from "../windows";

type OpenWindow = (
  kind: WindowKind,
  payload?: unknown,
  title?: string,
) => void;

interface PromptSessionActions {
  openWindow: OpenWindow;
  closeAllWindows: () => void;
  openSettings: () => void;
  openProjectSelector: () => void;
  toggleTheme: () => void;
}

/**
 * Owns the state and command routing for the prompt terminal — the shell's own
 * input. Slash commands dispatch UI actions; anything else is addressed to the
 * overseer itself. Model conversations are not here: each has its own window
 * and its own transcript (useChatSessions), and the bottom-left menu arms those
 * conversations rather than this one — so no option state lives here either.
 */
export function usePromptSession({
  openWindow,
  closeAllWindows,
  openSettings,
  openProjectSelector,
  toggleTheme,
}: PromptSessionActions) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const expand = useCallback(() => setOpen(true), []);
  const collapse = useCallback(() => setOpen(false), []);
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
    open,
    turns,
    busy,
    expand,
    collapse,
    resetTurns,
    submit,
    inspectTurn,
  };
}
