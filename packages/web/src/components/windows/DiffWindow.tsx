import { mockDiff } from "../../data/mock";

/** A diff is on a surface, so it uses the surface's status colours. */
const COLOR = {
  add: "var(--ok-fill)",
  del: "var(--accent-fill)",
  ctx: "var(--ink-dim)",
};

export function DiffWindow({ target }: { target: string }) {
  return (
    <div>
      <div className="w-path">{target}</div>
      <div className="w-pre">
        {mockDiff.map((line, i) => (
          <div key={i} style={{ color: COLOR[line.kind] }}>
            <span style={{ opacity: 0.4 }}>
              {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}{" "}
            </span>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
