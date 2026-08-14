import { useCallback, useState } from "react";
import { matchCommand } from "../commands";
import type { Turn } from "../domain";
import type { PromptOptionKey, PromptSettings } from "../prompt";
import type { WindowKind } from "../windows";

const BLANK_PROMPT_SETTINGS: PromptSettings = { model: "", mode: "", agent: "" };

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

/** Owns the state and command routing for the shell's single prompt session. */
export function usePromptSession({
  openWindow,
  closeAllWindows,
  openSettings,
  openProjectSelector,
  toggleTheme,
}: PromptSessionActions) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] =
    useState<PromptSettings>(BLANK_PROMPT_SETTINGS);
  const [openControl, setOpenControl] = useState<PromptOptionKey | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  const expand = useCallback(() => setOpen(true), []);
  const collapse = useCallback(() => setOpen(false), []);
  const resetTurns = useCallback(() => setTurns([]), []);
  const closeControl = useCallback(() => setOpenControl(null), []);

  const toggleControl = useCallback((key: PromptOptionKey) => {
    setOpenControl((current) => (current === key ? null : key));
  }, []);

  const selectControl = useCallback(
    (key: PromptOptionKey, value: string) => {
      setSettings((current) => ({ ...current, [key]: value }));
      setOpenControl(null);
    },
    [],
  );

  const loadTranscript = useCallback((nextTurns: Turn[]) => {
    setTurns(nextTurns);
    setOpen(true);
  }, []);

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
    settings,
    openControl,
    turns,
    busy,
    expand,
    collapse,
    resetTurns,
    closeControl,
    toggleControl,
    selectControl,
    loadTranscript,
    submit,
    inspectTurn,
  };
}
