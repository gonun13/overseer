import { StatusDot, type Status } from "./StatusDot";

export function RosterRow({
  status,
  primary,
  secondary,
  columns,
  active,
  onClick,
}: {
  status: Status;
  primary: string;
  secondary?: string;
  columns?: { value: string; width: string }[];
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-4 border-b border-border px-3 py-3 text-left tabular-nums hover:bg-panel-alt ${
        active ? "bg-panel-alt" : ""
      }`}
    >
      <StatusDot status={status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold tracking-[0.3px]">{primary}</span>
        {secondary && <span className="block truncate text-[11.5px] text-text-dim">{secondary}</span>}
      </span>
      {columns?.map((c, i) => (
        <span key={i} style={{ width: c.width }} className="shrink-0 text-right text-[12px] text-text-dim">
          {c.value}
        </span>
      ))}
    </button>
  );
}
