import { useCallback, useState } from "react";

/**
 * Whether this browser shows the field in fullscreen: the rails stand down
 * and the windows tile the whole viewport, with only the clock and the gear
 * left on the field (spec/ui-ux.md §1.1).
 *
 * Per browser, like the console layout, because it is a choice about this
 * screen rather than about the overseer (spec/data.md §5). Best effort:
 * storage can be missing or throw, and then the field opens with its rails.
 */

const KEY = "overseer.fullscreen.v1";

export function loadFullscreen(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function saveFullscreen(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "true" : "false");
  } catch {
    // No storage: the choice just won't survive a reload.
  }
}

export function useFullscreen(): [boolean, (on: boolean) => void] {
  const [fullscreen, setState] = useState(loadFullscreen);
  const setFullscreen = useCallback((on: boolean) => {
    setState(on);
    saveFullscreen(on);
  }, []);
  return [fullscreen, setFullscreen];
}
