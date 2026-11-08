/**
 * The field is three columns: a left rail (projects, sessions), the stage
 * (windows, and nothing else), and a right rail (clock, overseer, prompt,
 * provider). Every window lives inside the stage, so every placement — spawn,
 * tile, drag, resize, restore — asks the stage for its bounds here rather
 * than the viewport (spec/ui-ux.md §1, §5).
 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `h` is the whole window, tab included. */
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h?: number;
}

/** Between the stage edge and a window, and between tiled windows: the bare
 * minimum that still shows where one frame ends and the next begins. */
export const STAGE_GUTTER = 2;
export const TILE_GAP = 2;
export const MIN_WINDOW_W = 320;

/**
 * The stage, in viewport coordinates, less its gutter. Measured from the DOM
 * so the rails' `minmax` floor is honoured; before the stage has mounted it
 * falls back to the rail widths the grid declares.
 */
export function stageBounds(): Bounds {
  const el =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>(".stage");
  const rect = el?.getBoundingClientRect();
  const raw =
    rect !== undefined && rect.width > 0
      ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        }
      : {
          left: railWidth(),
          top: 0,
          right: window.innerWidth - railWidth(),
          bottom: window.innerHeight,
        };
  return {
    left: raw.left + STAGE_GUTTER,
    top: raw.top + STAGE_GUTTER,
    right: raw.right - STAGE_GUTTER,
    bottom: raw.bottom - STAGE_GUTTER,
  };
}

/** One rail's width, as the field grid declares it: an eighth of the
 * screen, floored at 286px. */
function railWidth(): number {
  return Math.max(286, window.innerWidth / 8);
}

/**
 * A grid of `n` cells filling `bounds`, as near square as the count allows,
 * vertical first: the second window stacks under the first, and each column
 * fills top to bottom before the next one starts. A last column holding fewer
 * windows shares the full height among them rather than leaving a hole. Never
 * more columns than fit at `MIN_WINDOW_W`: a crowded stage gets more rows
 * rather than columns too narrow to read. Cells always stay inside `bounds`;
 * on a stage too small for the minimum they shrink rather than overlap.
 */
export function tileGrid(
  n: number,
  bounds: Bounds,
  gap = TILE_GAP,
): Geometry[] {
  if (n <= 0) return [];
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const fit = Math.max(1, Math.floor((width + gap) / (MIN_WINDOW_W + gap)));
  let rows = Math.ceil(Math.sqrt(n));
  let cols = Math.ceil(n / rows);
  if (cols > fit) {
    cols = fit;
    rows = Math.ceil(n / cols);
  }
  const cellW = Math.floor((width - gap * (cols - 1)) / cols);
  return Array.from({ length: n }, (_, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const inCol = Math.min(rows, n - col * rows);
    const cellH = Math.floor((height - gap * (inCol - 1)) / inCol);
    return {
      x: bounds.left + col * (cellW + gap),
      y: bounds.top + row * (cellH + gap),
      w: cellW,
      h: cellH,
    };
  });
}

/**
 * The clock in fullscreen (spec/ui-ux.md §1.1): a chip floating in the stage's
 * top-right corner, over the windows, exactly as tall as a window tab so it
 * reads as part of the tab row. The CSS takes its size from these, so the
 * room a tab leaves for it and the chip itself cannot disagree.
 */
export const FLOATING_CLOCK_W = 124;
export const FLOATING_CLOCK_H = 27;

/**
 * How much of a window's tab runs under the floating clock: the room the tab
 * has to leave at its right so its close stays clear. Zero for a window whose
 * tab does not reach the corner — on a tiled stage, every window but the
 * top-right one.
 */
export function clockOverlap(win: Geometry, bounds: Bounds): number {
  const clockLeft = bounds.right - FLOATING_CLOCK_W;
  const clockBottom = bounds.top + FLOATING_CLOCK_H;
  if (win.y >= clockBottom || win.y + FLOATING_CLOCK_H <= bounds.top) return 0;
  const overlap =
    Math.min(win.x + win.w, bounds.right) - Math.max(win.x, clockLeft);
  return Math.max(0, overlap);
}

/** The lowest window's z-index: above every rail, below the floating clock
 * (190) and the settings panel (200). */
export const WINDOW_Z_BASE = 101;

/**
 * Rank the stack from `WINDOW_Z_BASE` up, with `topId` (when given) on top.
 * Ranks, not an ever-growing counter: a window is raised on every click, and
 * a counter would carry the stack over the clock and the settings panel within
 * a hundred of them. Windows whose rank did not change keep their object, and
 * an unchanged stack comes back as the same array.
 */
export function restack<T extends { id: string; z: number }>(
  list: T[],
  topId?: string,
): T[] {
  const order = [...list].sort(
    (a, b) =>
      Number(a.id === topId) - Number(b.id === topId) ||
      a.z - b.z ||
      list.indexOf(a) - list.indexOf(b),
  );
  const rank = new Map(order.map((w, i) => [w.id, WINDOW_Z_BASE + i]));
  let changed = false;
  const next = list.map((w) => {
    const z = rank.get(w.id)!;
    if (z === w.z) return w;
    changed = true;
    return { ...w, z };
  });
  return changed ? next : list;
}
