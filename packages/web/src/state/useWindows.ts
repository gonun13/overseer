import { useCallback, useState } from "react";
import { WINDOW_SPEC, type OpenWindow, type WindowKind } from "../windows";

let seq = 0;
/** Above every piece of permanent furniture, below the settings panel. Windows
 * carry this inline, so it — not the .window rule — decides the stack. */
let zSeq = 100;

/** The gutter the right-hand column keeps, matching the provider instrument. */
const RIGHT_MARGIN = 26;
/** No window spawns under the clock/settings corner. */
const TOP_CLEARANCE = 56;
/**
 * How tall the providers window is taken to be when centring it. It has no
 * fixed `h` — the body grows with the provider list — so this is an
 * assumption, not a measurement of a window that has not rendered yet.
 *
 * Deliberately short of the ~420 a full provider list actually renders at: a
 * low figure biases the spawn *down* the field, which keeps the top edge clear
 * of the overseer report in the same top-right corner. Measured on a 900-tall
 * viewport, it lands the frame at y 320 with the widget still uncovered below.
 */
const PROVIDERS_ASSUMED_HEIGHT = 260;

/** Right edge of the field, less the gutter — clamped onto narrow viewports. */
function rightAlignedX(width: number): number {
  return Math.max(24, window.innerWidth - width - RIGHT_MARGIN);
}

/**
 * Vertically centred for a window of `assumedHeight`, nudged by `cascade` for
 * repeats of the same kind and kept clear of the top corner.
 */
function midRightY(assumedHeight: number, cascade: number): number {
  return Math.max(
    TOP_CLEARANCE,
    Math.round((window.innerHeight - assumedHeight) / 2) + cascade,
  );
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

  const open = useCallback(
    (
      kind: WindowKind,
      payload?: unknown,
      title?: string,
      detail?: string,
      /** Exact placement — a restored layout, not a fresh spawn. */
      geometry?: WindowGeometry,
    ) => {
      setWindows((current) => {
        // Re-summoning a window that's already up raises it rather than stacking a duplicate.
        const existing = current.find(
          (w) => w.kind === kind && w.payload === payload,
        );
        if (existing) {
          return current.map((w) => (w === existing ? { ...w, z: ++zSeq } : w));
        }

        const spec = WINDOW_SPEC[kind];
        if (geometry !== undefined) {
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              ...(detail !== undefined ? { detail } : {}),
              ...clampGeometry(geometry),
              z: ++zSeq,
              payload,
            },
          ];
        }
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

        // Providers opens mid-right: right-aligned with the instrument that
        // summoned it (design-system.md §6.2), but vertically centred rather
        // than stacked directly above the widget — the operator reads it at
        // eye level, and the bottom-right corner stays the instrument's.
        if (kind === "providers") {
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              ...detailFields,
              x: rightAlignedX(width),
              y: midRightY(PROVIDERS_ASSUMED_HEIGHT, cascade),
              w: width,
              z: ++zSeq,
              payload,
            },
          ];
        }

        // Loop models opens from a row in the providers window's loop tab —
        // right-aligned the same way, with its top edge a fixed step above
        // providers' own (assumed) top edge, so it follows providers wherever
        // that lands. A fixed offset rather than providers' assumed height
        // *plus* this window's own (its `h` is tall enough, at ~380, that
        // subtracting both pushed the window up near the very top of the
        // viewport on an ordinary screen height — nowhere close to "just
        // above").
        if (kind === "loopModels") {
          const stackAbove = 70;
          const bodyH = height ?? spec.h ?? 380;
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              ...detailFields,
              x: rightAlignedX(width),
              y: Math.max(
                56,
                midRightY(PROVIDERS_ASSUMED_HEIGHT, cascade) - stackAbove,
              ),
              w: width,
              h: bodyH,
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

        // Project: top-centre — the git surface for the project the operator
        // is already looking at, so it opens directly under the centred
        // active-project readout (top 18, ~60 tall) rather than off in the
        // middle of the field. Centred horizontally on the viewport, clamped
        // so it never lands off-screen.
        if (kind === "project") {
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
              y: Math.max(56, 96 + cascade),
              w: width,
              ...(height !== undefined ? { h: height } : {}),
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

  /** Dismiss every window of a kind. */
  const closeKind = useCallback((kind: WindowKind) => {
    setWindows((current) => current.filter((w) => w.kind !== kind));
  }, []);

  /** Dismiss every window matching a predicate (e.g. consoles another tab
   * dismissed). */
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
      setWindows((current) => {
        const placeholder = current.find((w) => w.kind === kind && w.payload === from);
        if (placeholder === undefined) return current;
        const existing = current.find((w) => w.kind === kind && w.payload === to);
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
    [],
  );

  /** Lay every window of a kind out in a grid filling the field. */
  const tile = useCallback((kind: WindowKind) => {
    setWindows((current) => {
      const targets = current.filter((w) => w.kind === kind);
      if (targets.length === 0) return current;
      const n = targets.length;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const left = 16;
      const top = TOP_CLEARANCE + 40;
      const gap = 12;
      const chrome = 36; // tab above the body
      const bottom = 120; // the furniture along the bottom edge
      const cellW = Math.floor((window.innerWidth - left * 2 - gap * (cols - 1)) / cols);
      const cellH = Math.floor((window.innerHeight - top - bottom - gap * (rows - 1)) / rows);
      const placed = new Map<string, OpenWindow>();
      targets.forEach((w, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        placed.set(w.id, {
          ...w,
          x: left + col * (cellW + gap),
          y: top + row * (cellH + gap),
          w: Math.max(320, cellW),
          h: Math.max(160, cellH - chrome),
        });
      });
      return current.map((w) => placed.get(w.id) ?? w);
    });
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

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h?: number;
}

/** A saved layout may come from a bigger screen — keep it reachable. */
function clampGeometry(g: WindowGeometry): WindowGeometry {
  const w = Math.max(320, Math.min(g.w, window.innerWidth - 32));
  return {
    x: Math.max(0, Math.min(g.x, window.innerWidth - w)),
    y: Math.max(28, Math.min(g.y, window.innerHeight - 120)),
    w,
    ...(g.h !== undefined
      ? { h: Math.max(160, Math.min(g.h, window.innerHeight - 120)) }
      : {}),
  };
}
