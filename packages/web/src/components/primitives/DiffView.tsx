export type DiffLine = { kind: "add" | "del" | "ctx"; text: string };

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-[3px] bg-panel-alt font-mono text-[12.5px] leading-[1.6]">
      {lines.map((line, i) => (
        <div
          key={i}
          className="flex gap-3 px-3"
          style={{
            color: line.kind === "add" ? "var(--accent)" : line.kind === "del" ? "var(--danger)" : "var(--text)",
          }}
        >
          <span className="w-3 shrink-0 select-none text-text-faint">
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          </span>
          <span className="whitespace-pre">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
