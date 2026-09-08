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

        // Plans open under the project panel they belong to, left-aligned
        // with it (`.projects { left: 26px }` in styles/panels.css). The
        // panel's height is not fixed — its list grows with the workspace and
        // collapses to nothing — so this clears the tallest it gets
        // (`max-height: 44vh` plus its header) rather than measuring a piece
        // of furniture from inside the window system, the same assumed-
        // clearance approach the providers branch above takes.
        if (kind === "plans") {
          const left = 26;
          const panelTop = 20;
          const panelHeader = 34;
          const gap = 16;
          const chrome = 36; // tab above the body
          const below =
            panelTop +
            panelHeader +
            Math.round(window.innerHeight * 0.44) +
            gap;
          const y = Math.max(56, below + cascade);
          // On a short viewport the full body does not fit under the panel.
          // Give up height rather than the position: sliding up would put the
          // window over the very furniture it is explaining, which is worse
          // than a shorter list the operator can resize or scroll.
          const bodyH = Math.max(
            160,
            Math.min(height ?? spec.h ?? 360, window.innerHeight - y - chrome - 24),
          );
          return [
            ...current,
            {
              id: `${kind}-${++seq}`,
              kind,
              title: title ?? spec.title,
              ...detailFields,
              x: left,
              y,
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
