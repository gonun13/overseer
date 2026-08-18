/** Stroke-only glyphs at 1px, drawn on a 16-unit grid so they sit on the type
 * baseline without optical adjustment. No icon font, no emoji in chrome. */

const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  "aria-hidden": true,
} as const;

export function CloseIcon() {
  return (
    <svg {...base} width={11} height={11}>
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

/** Larger than the other glyphs and unboxed — it is its own control, so it
 * carries its own weight rather than borrowing a border to be findable.
 * The hub uses `--mark` so it tracks the theme identity colour (red /
 * blue); the ring stays on the button's ink. */
export function GearIcon() {
  return (
    <svg {...base} width={30} height={30}>
      <circle cx="8" cy="8" r="2.6" stroke="var(--mark)" />
      <circle cx="8" cy="8" r="6.2" strokeDasharray="1.7 2.3" />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      {...base}
      width={10}
      height={10}
      style={{ transform: open ? "rotate(180deg)" : "none" }}
    >
      <path d="M3 6l5 5 5-5" />
    </svg>
  );
}

/** Bottom-right window resize grip — two short strokes, not a filled corner. */
export function ResizeIcon() {
  return (
    <svg {...base} width={12} height={12}>
      <path d="M6 14L14 6M10 14L14 10" />
    </svg>
  );
}

/** A trash can, drawn the way the other glyphs are: outline only, no fill. */
export function TrashIcon() {
  return (
    <svg {...base} width={12} height={12}>
      <path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}
