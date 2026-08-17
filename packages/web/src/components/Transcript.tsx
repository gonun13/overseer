import { useEffect, useRef } from "react";
import type { Turn } from "../domain";

/**
 * Lives inside a session window or the prompt terminal when it shows history.
 *
 * The distinction that matters here is **who did it**. What the agent produced
 * is printed: a stamp laid on the surface, the same material as tabs, chips and
 * buttons. What you asked for stays part of the surface you asked it from — open
 * text in the prompt's own colours, marked by an accent lane. Nothing is a
 * bubble and nothing is aligned to a side (design-system.md §7.2).
 */
export function Transcript({
  turns,
  onInspect,
}: {
  turns: Turn[];
  onInspect: (id: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  return (
    <div className="transcript no-drag">
      {turns.map((turn) => {
        if (turn.kind === "tool") {
          return (
            <button
              key={turn.id}
              className="turn-tool"
              onClick={() => onInspect(turn.id)}
            >
              <span style={{ color: "var(--accent)" }}>▸</span>
              <span className="turn-tool-name">{turn.tool}</span>
              <span className="turn-tool-target">{turn.target}</span>
            </button>
          );
        }
        return (
          <div
            key={turn.id}
            className={turn.kind === "user" ? "turn-operator" : "turn-agent"}
          >
            <div className="turn-label">
              {turn.kind === "user" ? "operator" : "agent"}
            </div>
            <p className="turn-text">{turn.text}</p>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
