export function ColumnHeader({ columns }: { columns: { label: string; width: string }[] }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-2 text-[10.5px] uppercase tracking-[1px] text-text-faint">
      <span className="flex-1">&nbsp;</span>
      {columns.map((c) => (
        <span key={c.label} style={{ width: c.width }} className="shrink-0 text-right">
          {c.label}
        </span>
      ))}
    </div>
  );
}
