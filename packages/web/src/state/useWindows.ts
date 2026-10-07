import { useCallback, useEffect, useState } from "react";
import { WINDOW_SPEC, type OpenWindow, type WindowKind } from "../windows";
import {
  MIN_WINDOW_W,
  stageBounds,
  tileGrid,
  type Bounds,
  type Geometry,
} from "../layout";

let seq = 0;
/** Above every piece of permanent furniture, below the settings panel. Windows
 * carry this inline, so it — not the .window rule — decides the stack. */
let zSeq = 100;

/** Every window fills the stage as one grid, in the order it was opened —
 * the harness view: everything on the desk visible at once, nothing stacked
 * over anything else (spec/ui-ux.md §5). */
function retile(current: OpenWindow[], bounds: Bounds): OpenWindow[] {
  if (current.length === 0) return current;
  const cells = tileGrid(current.length, bounds);
  return current.map((w, i) => ({ ...w, ...cells[i] }));
}

export function useWindows() {
  const [windows, setWindows] = useState<OpenWindow[]>([]);

  /** Stacking is z-index, never DOM order: reordering the array makes React move
   * the node on pointerdown, which swallows the click that follows. */
  const raise = useCallback((id: string) => {
    setWindows((current) =>
      current.map((w) => (w.id === id ? { ...w, z: ++zSeq } : w)),
    );
  }, []);

  /** Wrap an updater so that any window opening or closing re-tiles the
   * stage in the same render — a new window never flashes at a spawn point. */
  const update = useCallback((fn: (current: OpenWindow[]) => OpenWindow[]) => {
    setWindows((current) => {
      const next = fn(current);
      return next.length !== current.length
        ? retile(next, stageBounds())
        : next;
    });
  }, []);

  // The stage follows the viewport.
  useEffect(() => {
    function onResize() {
      setWindows((current) => retile(current, stageBounds()));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const open = useCallback(
    (kind: WindowKind, payload?: unknown, title?: string, detail?: string) => {
      update((current) => {
        // Re-summoning a window that's already up raises it rather than stacking a duplicate.
        const existing = current.find(
          (w) => w.kind === kind && w.payload === payload,
        );
        if (existing) {
          return current.map((w) => (w === existing ? { ...w, z: ++zSeq } : w));
        }

        return [
          ...current,
          {
            id: `${kind}-${++seq}`,
            kind,
            title: title ?? WINDOW_SPEC[kind].title,
            ...(detail !== undefined ? { detail } : {}),
            // Placeholder geometry: `update` tiles it before it renders.
            x: 0,
            y: 0,
            w: MIN_WINDOW_W,
            z: ++zSeq,
            payload,
          },
        ];
      });
    },
    [update],
  );

  const close = useCallback(
    (id: string) => update((current) => current.filter((w) => w.id !== id)),
    [update],
  );

  /** Dismisses the topmost window by stacking order, not insertion order. */
  const closeTop = useCallback(() => {
    update((current) => {
      if (current.length === 0) return current;
      const top = current.reduce((a, b) => (b.z > a.z ? b : a));
      return current.filter((w) => w !== top);
    });
  }, [update]);

  const closeAll = useCallback(() => setWindows([]), []);

  /** Dismiss every window of a kind. */
  const closeKind = useCallback(
    (kind: WindowKind) =>
      update((current) => current.filter((w) => w.kind !== kind)),
    [update],
  );

  /** Dismiss every window matching a predicate (e.g. consoles another tab
   * dismissed). */
  const closeWhere = useCallback(
    (predicate: (w: OpenWindow) => boolean) =>
      update((current) => {
        const next = current.filter((w) => !predicate(w));
        // Called from an effect on every console-list change: bail out with
        // the same array when nothing matched, or React re-renders forever.
        return next.length === current.length ? current : next;
      }),
    [update],
  );

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

  /**
   * Re-key a window — a console window opens on its request id and becomes
   * the console's own once the server answers. If a window already shows the
   * new payload (the server attached an existing console), the placeholder
   * goes and that one is raised instead.
   */
  const rekey = useCallback(
    (
      kind: WindowKind,
      from: unknown,
      to: unknown,
      title?: string,
      detail?: string,
    ) => {
      update((current) => {
        const placeholder = current.find(
          (w) => w.kind === kind && w.payload === from,
        );
        if (placeholder === undefined) return current;
        const existing = current.find(
          (w) => w.kind === kind && w.payload === to,
        );
        if (existing !== undefined) {
          return current
            .filter((w) => w !== placeholder)
            .map((w) => (w === existing ? { ...w, z: ++zSeq } : w));
        }
        return current.map((w) =>
          w === placeholder
            ? {
                ...w,
                payload: to,
                ...(title !== undefined ? { title } : {}),
                ...(detail !== undefined ? { detail } : {}),
              }
            : w,
        );
      });
    },
    [update],
  );

  /** Put every window back on the grid — after the operator has dragged or
   * resized some. */
  const tile = useCallback(() => {
    setWindows((current) => retile(current, stageBounds()));
  }, []);

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
    rekey,
    tile,
  };
}

export type WindowGeometry = Geometry;
