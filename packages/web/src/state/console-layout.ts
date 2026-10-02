import type { OpenWindow } from "../windows";
import type { WindowGeometry } from "./useWindows";

/**
 * Where this browser had its console windows. The consoles themselves live on
 * the server and survive a reload; this is only which of them were on screen
 * and where, so the desk comes back the way it was left.
 *
 * Per browser, in localStorage, and best effort: storage can be missing or
 * throw (private windows, blocked site data), and then the desk simply starts
 * empty — every console is still one click away in the console list.
 */

const KEY = "overseer.console-layout.v1";

export interface SavedConsoleWindow extends WindowGeometry {
  consoleId: string;
  z: number;
}

export function saveConsoleLayout(windows: OpenWindow[]): void {
  const saved: SavedConsoleWindow[] = windows
    .filter((w) => w.kind === "console" && isConsoleId(w.payload))
    .map((w) => ({
      consoleId: w.payload as string,
      x: w.x,
      y: w.y,
      w: w.w,
      ...(w.h !== undefined ? { h: w.h } : {}),
      z: w.z,
    }));
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // No storage: the layout just won't survive a reload.
  }
}

export function loadConsoleLayout(): SavedConsoleWindow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is SavedConsoleWindow =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.consoleId === "string" &&
          typeof entry.x === "number" &&
          typeof entry.y === "number" &&
          typeof entry.w === "number",
      )
      .sort((a, b) => a.z - b.z);
  } catch {
    return [];
  }
}

/** A console window's payload is the console id, or `pending:<reqId>` while
 * the server has not answered — those are never saved. */
export function isConsoleId(payload: unknown): payload is string {
  return typeof payload === "string" && !payload.startsWith(PENDING_PREFIX);
}

export const PENDING_PREFIX = "pending:";
