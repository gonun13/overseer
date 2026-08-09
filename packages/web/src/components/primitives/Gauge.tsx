export function Gauge({
  label,
  pct,
  readout,
  width = "120px",
}: {
  label?: string;
  pct: number;
  readout: string;
  width?: string;
}) {
  const color = pct >= 95 ? "var(--danger)" : pct >= 80 ? "var(--warn)" : "var(--accent)";
  return (
    <span className="flex items-center gap-2 text-[12px]">
      {label && <span className="uppercase tracking-[1px] text-text-faint">{label}</span>}
      <span
        style={{ width }}
        className="h-[6px] overflow-hidden rounded-[2px] bg-panel-alt"
      >
        <span
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }}
          className="block h-full"
        />
      </span>
      <span className="tabular-nums text-text">{readout}</span>
    </span>
  );
}
