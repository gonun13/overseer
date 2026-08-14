import { useCallback, useState } from "react";
import { WINDOW_SPEC, type OpenWindow, type WindowKind } from "../windows";

let seq = 0;
/** Above every piece of permanent furniture, below the settings panel. Windows
 * carry this inline, so it — not the .window rule — decides the stack. */
let zSeq = 100;

export function useWindows() {
  const [windows, setWindows] = useState<OpenWindow[]>([]);

  /** Stacking is z-index, never DOM order: reordering the array makes React move
   * the node on pointerdown, which swallows the click that follows. */
  const raise = useCallback((id: string) => {
    setWindows((current) =>
      current.map((w) => (w.id === id ? { ...w, z: ++zSeq } : w)),
    );
  }, []);

  const open = useCallback(
    (kind: WindowKind, payload?: unknown, title?: string) => {
      setWindows((current) => {
        // Re-summoning a window that's already up raises it rather than stacking a duplicate.
        const existing = current.find(
          (w) => w.kind === kind && w.payload === payload,
        );
        if (existing) {
          return current.map((w) => (w === existing ? { ...w, z: ++zSeq } : w));
        }

        const spec = WINDOW_SPEC[kind];
        // Each kind has its own home; only repeats of the same kind cascade off it.
        const cascade = current.filter((w) => w.kind === kind).length * 24;
        // Clamp on spawn so a window never lands off-screen on a small viewport.
        const width = Math.min(spec.w, window.innerWidth - 64);

        // Providers opens from the instrument that summoned it: right-aligned
        // with the bottom-right widget, sitting just above it rather than at a
        // fixed mid-field y (design-system.md §6.2).
        if (kind === "providers") {
          const margin = 26;
          const widgetClearance = 210; // widget + optional console + gap
          const assumedHeight = 260;
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              x: Math.max(24, window.innerWidth - width - margin),
              y: Math.max(
                56,
                window.innerHeight - widgetClearance - assumedHeight + cascade,
              ),
              w: width,
              z: ++zSeq,
              payload,
            },
          ];
        }

        return [
          ...current,
          {
            id: `${kind}-${++seq}`,
            kind,
            title: title ?? spec.title,
            x: Math.max(
              24,
              Math.min(spec.x + cascade, window.innerWidth - width - 24),
            ),
            y: Math.max(
              56,
              Math.min(spec.y + cascade, window.innerHeight - 200),
            ),
            w: width,
            z: ++zSeq,
            payload,
          },
        ];
      });
    },
    [],
  );

  const close = useCallback((id: string) => {
    setWindows((current) => current.filter((w) => w.id !== id));
  }, []);

  /** Dismisses the topmost window by stacking order, not insertion order. */
  const closeTop = useCallback(() => {
    setWindows((current) => {
      if (current.length === 0) return current;
      const top = current.reduce((a, b) => (b.z > a.z ? b : a));
      return current.filter((w) => w !== top);
    });
  }, []);

  const closeAll = useCallback(() => setWindows([]), []);

  const move = useCallback((id: string, x: number, y: number) => {
    setWindows((current) =>
      current.map((w) => (w.id === id ? { ...w, x, y } : w)),
    );
  }, []);

  return { windows, open, close, closeTop, closeAll, raise, move };
}
