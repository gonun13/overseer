import { useEffect } from "react";
import type { PromptOptionKey } from "../prompt";

interface ShellKeyboardOptions {
  /** A decision is up. Every command is off, including Escape: the decision is
   * answered with its own two buttons or not at all (ui-ux-design.md §5.2). */
  blocked: boolean;
  settingsOpen: boolean;
  windowCount: number;
  openControl: PromptOptionKey | null;
  promptOpen: boolean;
  promptOptionKeys: readonly PromptOptionKey[];
  /** The menu arms the focused session; with none focused it is not on the
   * field, and its digits must not act on something the operator cannot see. */
  controlsAvailable: boolean;
  closeSettings: () => void;
  closeTopWindow: () => void;
  closeControl: () => void;
  closePrompt: () => void;
  toggleControl: (key: PromptOptionKey) => void;
  openContext: () => void;
  openPrompt: () => void;
  toggleProjects: () => void;
  toggleSettings: () => void;
}

/** Registers the application shell's global keyboard command layer. */
export function useShellKeyboard({
  blocked,
  settingsOpen,
  windowCount,
  openControl,
  promptOpen,
  promptOptionKeys,
  controlsAvailable,
  closeSettings,
  closeTopWindow,
  closeControl,
  closePrompt,
  toggleControl,
  openContext,
  openPrompt,
  toggleProjects,
  toggleSettings,
}: ShellKeyboardOptions) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (blocked) return;

      if (event.key === "Escape") {
        if (settingsOpen) closeSettings();
        else if (windowCount > 0) closeTopWindow();
        else if (openControl) closeControl();
        else closePrompt();
        return;
      }

      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea");

      // Bare digits control the closed prompt; an open prompt owns every key.
      if (
        controlsAvailable &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !promptOpen &&
        !typing
      ) {
        const index = Number(event.key);
        if (index >= 1 && index <= promptOptionKeys.length) {
          event.preventDefault();
          toggleControl(promptOptionKeys[index - 1]);
          return;
        }
        if (index === promptOptionKeys.length + 1) {
          event.preventDefault();
          openContext();
          return;
        }
      }

      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "k") {
        event.preventDefault();
        openPrompt();
      } else if (event.key === "p") {
        event.preventDefault();
        toggleProjects();
      } else if (event.key === ",") {
        event.preventDefault();
        toggleSettings();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    blocked,
    closeControl,
    closePrompt,
    closeSettings,
    closeTopWindow,
    controlsAvailable,
    openContext,
    openControl,
    openPrompt,
    promptOpen,
    promptOptionKeys,
    settingsOpen,
    toggleControl,
    toggleProjects,
    toggleSettings,
    windowCount,
  ]);
}
