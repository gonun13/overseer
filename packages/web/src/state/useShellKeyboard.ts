import { useEffect } from "react";
import type { SessionOptionKey } from "../session";

interface ShellKeyboardOptions {
  /** A decision is up. Every command is off, including Escape: the decision is
   * answered with its own two buttons or not at all (ui-ux-design.md §5.2). */
  blocked: boolean;
  settingsOpen: boolean;
  windowCount: number;
  openSessionControl: SessionOptionKey | null;
  /** Whether the prompt bar is focused; session-control digits stand down while
   * it is. */
  promptFocused: boolean;
  sessionOptionKeys: readonly SessionOptionKey[];
  /** The focused session's controls; digits on the prompt terminal target these
   * when a session is active and the terminal is unfocused. */
  sessionControlsAvailable: boolean;
  closeSettings: () => void;
  closeTopWindow: () => void;
  closeSessionControl: () => void;
  blurPrompt: () => void;
  toggleSessionControl: (key: SessionOptionKey) => void;
  openSessionContext: () => void;
  focusPrompt: () => void;
  toggleProjects: () => void;
  toggleSettings: () => void;
}

/** Registers the application shell's global keyboard command layer. */
export function useShellKeyboard({
  blocked,
  settingsOpen,
  windowCount,
  openSessionControl,
  promptFocused,
  sessionOptionKeys,
  sessionControlsAvailable,
  closeSettings,
  closeTopWindow,
  closeSessionControl,
  blurPrompt,
  toggleSessionControl,
  openSessionContext,
  focusPrompt,
  toggleProjects,
  toggleSettings,
}: ShellKeyboardOptions) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (blocked) return;

      if (event.key === "Escape") {
        if (settingsOpen) closeSettings();
        else if (windowCount > 0) closeTopWindow();
        else if (openSessionControl) closeSessionControl();
        else blurPrompt();
        return;
      }

      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea");

      // Bare digits open session controls on the focused session when the
      // prompt terminal is not focused.
      if (
        sessionControlsAvailable &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !promptFocused &&
        !typing
      ) {
        const index = Number(event.key);
        if (index >= 1 && index <= sessionOptionKeys.length) {
          event.preventDefault();
          toggleSessionControl(sessionOptionKeys[index - 1]);
          return;
        }
        if (index === sessionOptionKeys.length + 1) {
          event.preventDefault();
          openSessionContext();
          return;
        }
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
    closeSessionControl,
    closeSettings,
    closeTopWindow,
    focusPrompt,
    openSessionContext,
    openSessionControl,
    promptFocused,
    sessionControlsAvailable,
    sessionOptionKeys,
    settingsOpen,
    toggleProjects,
    toggleSessionControl,
    toggleSettings,
    windowCount,
  ]);
}
