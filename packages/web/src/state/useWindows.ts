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
    (kind: WindowKind, payload?: unknown, title?: string, detail?: string) => {
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
        const height =
          spec.h === undefined
            ? undefined
            : Math.min(spec.h, window.innerHeight - 160);
        const detailFields =
          detail !== undefined ? ({ detail } as const) : ({} as const);

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
              ...detailFields,
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

        // Console: mid-right — right-aligned like the provider instrument, but
        // vertically centred so a tall terminal doesn't sit on top of it.
        if (kind === "console") {
          const margin = 26;
          const bodyH = height ?? 480;
          const chrome = 36; // tab above the body
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              ...detailFields,
              x: Math.max(24, window.innerWidth - width - margin),
              y: Math.max(
                56,
                Math.min(
                  window.innerHeight - bodyH - chrome - 24,
                  Math.round((window.innerHeight - bodyH - chrome) / 2) +
                    cascade,
                ),
              ),
              w: width,
              h: bodyH,
              z: ++zSeq,
              payload,
            },
          ];
        }

        // Chat: mid-bottom — centred on the field and low, so a conversation
        // opens where the operator is already looking, but above the prompt
        // terminal and the footer rather than on top of them.
        if (kind === "chat") {
          const bodyH = height ?? 420;
          const chrome = 36; // tab above the body
          const dockClearance = 140; // prompt terminal + footer
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              ...detailFields,
              x: Math.max(
                24,
                Math.min(
                  Math.round((window.innerWidth - width) / 2) + cascade,
                  window.innerWidth - width - 24,
                ),
              ),
              y: Math.max(
                56,
                window.innerHeight - bodyH - chrome - dockClearance + cascade,
              ),
              w: width,
              h: bodyH,
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
            ...detailFields,
            x: Math.max(
              24,
              Math.min(spec.x + cascade, window.innerWidth - width - 24),
            ),
            y: Math.max(
              56,
              Math.min(spec.y + cascade, window.innerHeight - 200),
            ),
            w: width,
            ...(height !== undefined ? { h: height } : {}),
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

  /** Dismiss every window of a kind (e.g. console when the active project flips). */
  const closeKind = useCallback((kind: WindowKind) => {
    setWindows((current) => current.filter((w) => w.kind !== kind));
  }, []);

  /** Dismiss every window matching a predicate (e.g. a chat window whose
   * session belongs to a project that just stopped being active — a session
   * window is scoped to the project its session runs in, the same way
   * console is scoped to the cwd it opened in). */
  const closeWhere = useCallback((predicate: (w: OpenWindow) => boolean) => {
    setWindows((current) => current.filter((w) => !predicate(w)));
  }, []);

  // `.map()` always allocates, so an updater written that way hands React a new
  // array even when nothing matched or nothing changed — and React re-renders on
  // reference inequality alone. These three are called from pointer handlers and
  // from an effect that sweeps every session, so they have to be able to bail
  // out by returning `current` untouched.
  const move = useCallback((id: string, x: number, y: number) => {
    setWindows((current) => {
      const i = current.findIndex((w) => w.id === id);
      if (i === -1) return current;
      const win = current[i];
      if (win.x === x && win.y === y) return current;
      const next = current.slice();
      next[i] = { ...win, x, y };
      return next;
    });
  }, []);

  const resize = useCallback((id: string, w: number, h: number) => {
    setWindows((current) => {
      const i = current.findIndex((win) => win.id === id);
      if (i === -1) return current;
      const win = current[i];
      if (win.w === w && win.h === h) return current;
      const next = current.slice();
      next[i] = { ...win, w, h };
      return next;
    });
  }, []);

  const retitle = useCallback(
    (kind: WindowKind, payload: unknown, title: string, detail?: string) => {
      setWindows((current) => {
        const i = current.findIndex(
          (w) => w.kind === kind && w.payload === payload,
        );
        if (i === -1) return current;
        const win = current[i];
        if (win.title === title && win.detail === detail) return current;
        const next = current.slice();
        next[i] = { ...win, title, detail };
        return next;
      });
    },
    [],
  );

  return {
    windows,
    open,
    close,
    closeTop,
    closeAll,
    closeKind,
    closeWhere,
    raise,
    move,
    resize,
    retitle,
  };
}
