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
 * carries its own weight rather than borrowing a border to be findable. */
export function GearIcon() {
  return (
    <svg {...base} width={20} height={20}>
      <circle cx="8" cy="8" r="2.6" />
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
