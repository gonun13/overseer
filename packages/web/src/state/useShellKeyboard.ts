import { useEffect } from "react";

interface ShellKeyboardOptions {
  /** A decision is up. Every command is off, including Escape: the decision is
   * answered with its own two buttons or not at all (spec/ui-ux.md §5.4). */
  blocked: boolean;
  settingsOpen: boolean;
  windowCount: number;
  closeSettings: () => void;
  closeTopWindow: () => void;
  blurPrompt: () => void;
  focusPrompt: () => void;
  toggleProjects: () => void;
  toggleSettings: () => void;
  /** Raise the next console window and focus its terminal. */
  cycleConsoles: () => void;
}

/**
 * Registers the application shell's global keyboard command layer.
 *
 * A focused terminal owns the keyboard — Escape, Ctrl+K and the rest belong
 * to the CLI running in it — so nothing here fires while focus is inside one,
 * except the console cycle (Ctrl+`), which is how you leave it.
 */
export function useShellKeyboard({
  blocked,
  settingsOpen,
  windowCount,
  closeSettings,
  closeTopWindow,
  blurPrompt,
  focusPrompt,
  toggleProjects,
  toggleSettings,
  cycleConsoles,
}: ShellKeyboardOptions) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (blocked) return;

      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        cycleConsoles();
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest(".xterm")) return;

      if (event.key === "Escape") {
        if (settingsOpen) closeSettings();
        else if (windowCount > 0) closeTopWindow();
        else blurPrompt();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "k") {
        event.preventDefault();
        focusPrompt();
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
    blurPrompt,
    closeSettings,
    closeTopWindow,
    cycleConsoles,
    focusPrompt,
    settingsOpen,
    toggleProjects,
    toggleSettings,
    windowCount,
  ]);
}
